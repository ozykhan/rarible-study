import { createHash } from "node:crypto"
import {
  type Address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
  isFullySignedTransaction,
  isSome,
  type KeyPairSigner,
  lamports,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Signature,
  signTransactionMessageWithSigners,
  verifySignature
} from "@solana/kit"
import { getAddMemoInstruction } from "@solana-program/memo"
import { getCreateAccountInstruction } from "@solana-program/system"
import {
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  getTokenDecoder,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS
} from "@solana-program/token"
import { Context, Effect, Layer, Schema } from "effect"
import { Chain, ChainError } from "./Chain.ts"

/**
 * The demo token, "dUSD": an SPL token Slabwatch mints itself on devnet, with
 * 2 decimals so one unit is one US cent. It has no value anywhere.
 */
export const DUSD_DECIMALS = 2

/** The server's devnet keys, derived from one seed so a deploy needs a single secret. */
export interface DevnetKeys {
  /** Pays fees and rent, and is the mint authority. */
  readonly treasury: KeyPairSigner
  /** Spends what a collector approved, and nothing else: it holds no tokens itself. */
  readonly delegate: KeyPairSigner
  readonly mint: KeyPairSigner
  /** Owns the mock escrow account that purchases pay into. */
  readonly escrow: KeyPairSigner
}

export class DevnetSeedError extends Schema.TaggedError<DevnetSeedError>()("DevnetSeedError", {
  message: Schema.String
}) {}

export const deriveDevnetKeys = (seedHex: string) =>
  Effect.gen(function* () {
    if (!/^[0-9a-f]{64}$/i.test(seedHex)) {
      return yield* new DevnetSeedError({ message: "DEVNET_SEED must be 64 hex characters (32 random bytes)" })
    }
    const seed = Buffer.from(seedHex, "hex")
    const derive = (label: string) =>
      Effect.promise(() =>
        createKeyPairSignerFromPrivateKeyBytes(
          new Uint8Array(createHash("sha256").update(seed).update(`slabwatch-devnet:${label}`).digest())
        )
      )
    return {
      treasury: yield* derive("treasury"),
      delegate: yield* derive("delegate"),
      mint: yield* derive("mint"),
      escrow: yield* derive("escrow")
    } satisfies DevnetKeys
  })

export interface TokenFunds {
  readonly wallet: Address
  readonly tokenAccount: Address
  readonly tokenAccountExists: boolean
  /** dUSD the wallet holds, in units (cents). */
  readonly balanceUnits: bigint
  /** What Slabwatch's delegate may still spend from it, in units. Zero when someone else is the delegate. */
  readonly allowanceUnits: bigint
  readonly lamports: bigint
}

export interface SetupReport {
  readonly cluster: "devnet" | "local"
  readonly treasury: Address
  readonly treasuryLamports: bigint
  readonly mint: Address
  readonly escrowAccount: Address
  readonly delegate: Address
  readonly created: ReadonlyArray<string>
  /** Set when the treasury is too low on SOL to pay fees and the faucet refused an airdrop. */
  readonly needsFunding: string | null
}

/** Below this the treasury asks the devnet faucet for more SOL. */
const MIN_TREASURY_LAMPORTS = 50_000_000n
const AIRDROP_LAMPORTS = 1_000_000_000n

export class Treasury extends Context.Service<
  Treasury,
  {
    readonly cluster: "devnet" | "local"
    readonly addresses: {
      readonly treasury: Address
      readonly delegate: Address
      readonly mint: Address
      readonly escrowOwner: Address
      readonly escrowAccount: Address
    }
    /** Creates the mint and the escrow account if they are missing. Safe to run on every boot. */
    readonly setup: Effect.Effect<SetupReport, ChainError>
    readonly funds: (wallet: Address) => Effect.Effect<TokenFunds, ChainError>
    /** Mints test dUSD to a wallet, creating its token account if needed. */
    readonly faucet: (wallet: Address, units: bigint) => Effect.Effect<Signature, ChainError>
    /**
     * An unsigned-by-the-collector transaction that approves Slabwatch's
     * delegate to spend up to `units` from the wallet's dUSD account. The
     * treasury pays the fee and has already signed; the wallet adds its
     * signature, and `submitSigned` sends it.
     */
    readonly allowanceTransaction: (wallet: Address, units: bigint) => Effect.Effect<string, ChainError>
    /** Sends a transaction this server built and the collector signed. Refuses anything else. */
    readonly submitSigned: (wireBase64: string) => Effect.Effect<Signature, ChainError>
    /** Moves `units` from the wallet to the escrow as the delegate, with a memo. */
    readonly pay: (from: Address, units: bigint, memo: string) => Effect.Effect<Signature, ChainError>
  }
>()("slabwatch/Treasury") {}

const fail = (message: string) => Effect.fail(new ChainError({ message }))

export const makeTreasury = (keys: DevnetKeys) =>
  Effect.gen(function* () {
    const chain = yield* Chain
    const { treasury, delegate, mint, escrow } = keys

    const ataOf = (owner: Address) =>
      Effect.promise(() => findAssociatedTokenPda({ owner, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS })).pipe(
        Effect.map(([pda]) => pda)
      )
    const escrowAccount = yield* ataOf(escrow.address)

    const buildMessage = (instructions: ReadonlyArray<Instruction>) =>
      Effect.map(chain.latestBlockhash, (lifetime) =>
        pipe(
          createTransactionMessage({ version: "legacy" }),
          (m) => setTransactionMessageFeePayerSigner(treasury, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
          (m) => appendTransactionMessageInstructions(instructions, m)
        )
      )

    const sendSigned = (instructions: ReadonlyArray<Instruction>) =>
      Effect.gen(function* () {
        const message = yield* buildMessage(instructions)
        const tx = yield* Effect.tryPromise({
          try: () => signTransactionMessageWithSigners(message),
          catch: (e) => new ChainError({ message: `signing failed: ${String(e)}` })
        })
        return yield* chain.sendAndConfirm(tx)
      })

    const report = (balance: bigint, created: ReadonlyArray<string>): SetupReport => ({
      cluster: chain.cluster,
      treasury: treasury.address,
      treasuryLamports: balance,
      mint: mint.address,
      escrowAccount,
      delegate: delegate.address,
      created,
      needsFunding: null
    })

    const setup = Effect.gen(function* () {
      const created: Array<string> = []
      let balance = yield* chain.getBalance(treasury.address)
      let needsFunding: string | null = null
      if (balance < MIN_TREASURY_LAMPORTS) {
        const airdrop = yield* Effect.result(chain.requestAirdrop(treasury.address, AIRDROP_LAMPORTS))
        if (airdrop._tag === "Success") {
          created.push("airdrop")
          balance = yield* chain.getBalance(treasury.address)
        } else {
          needsFunding = `the treasury ${treasury.address} has ${balance} lamports and the faucet refused an airdrop: ${airdrop.failure.message}`
          return { ...report(balance, created), needsFunding }
        }
      }
      const instructions: Array<Instruction> = []
      const mintAccount = yield* chain.getAccount(mint.address)
      if (!mintAccount.exists) {
        const space = getMintSize()
        instructions.push(
          getCreateAccountInstruction({
            payer: treasury,
            newAccount: mint,
            lamports: lamports(yield* chain.rentExempt(space)),
            space,
            programAddress: TOKEN_PROGRAM_ADDRESS
          }),
          getInitializeMint2Instruction({ mint: mint.address, decimals: DUSD_DECIMALS, mintAuthority: treasury.address })
        )
        created.push("mint")
      }
      const escrowExists = (yield* chain.getAccount(escrowAccount)).exists
      if (!escrowExists) {
        instructions.push(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: treasury,
            ata: escrowAccount,
            owner: escrow.address,
            mint: mint.address
          })
        )
        created.push("escrow account")
      }
      if (instructions.length > 0) yield* sendSigned(instructions)
      return { ...report(balance, created), needsFunding }
    }).pipe(Effect.withSpan("Treasury.setup"))

    const funds = Effect.fn("Treasury.funds")(function* (wallet: Address) {
      const tokenAccount = yield* ataOf(wallet)
      const account = yield* chain.getAccount(tokenAccount)
      const sol = yield* chain.getBalance(wallet)
      if (!account.exists) {
        return { wallet, tokenAccount, tokenAccountExists: false, balanceUnits: 0n, allowanceUnits: 0n, lamports: sol }
      }
      const token = getTokenDecoder().decode(account.data)
      const ours = isSome(token.delegate) && token.delegate.value === delegate.address
      return {
        wallet,
        tokenAccount,
        tokenAccountExists: true,
        balanceUnits: token.amount,
        allowanceUnits: ours ? token.delegatedAmount : 0n,
        lamports: sol
      }
    })

    const faucet = Effect.fn("Treasury.faucet")(function* (wallet: Address, units: bigint) {
      const tokenAccount = yield* ataOf(wallet)
      return yield* sendSigned([
        getCreateAssociatedTokenIdempotentInstruction({ payer: treasury, ata: tokenAccount, owner: wallet, mint: mint.address }),
        getMintToCheckedInstruction({
          mint: mint.address,
          token: tokenAccount,
          mintAuthority: treasury,
          amount: units,
          decimals: DUSD_DECIMALS
        })
      ])
    })

    const allowanceTransaction = Effect.fn("Treasury.allowanceTransaction")(function* (wallet: Address, units: bigint) {
      const tokenAccount = yield* ataOf(wallet)
      const message = yield* buildMessage([
        getCreateAssociatedTokenIdempotentInstruction({ payer: treasury, ata: tokenAccount, owner: wallet, mint: mint.address }),
        getApproveCheckedInstruction({
          source: tokenAccount,
          mint: mint.address,
          delegate: delegate.address,
          owner: createNoopSigner(wallet),
          amount: units,
          decimals: DUSD_DECIMALS
        })
      ])
      const tx = yield* Effect.tryPromise({
        try: () => partiallySignTransactionMessageWithSigners(message),
        catch: (e) => new ChainError({ message: `signing failed: ${String(e)}` })
      })
      return getBase64EncodedWireTransaction(tx)
    })

    const submitSigned = Effect.fn("Treasury.submitSigned")(function* (wireBase64: string) {
      const decoded = yield* Effect.try({
        try: () => {
          const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wireBase64))
          const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
          return { tx, feePayer: message.staticAccounts[0] }
        },
        catch: () => new ChainError({ message: "that is not a Solana transaction" })
      })
      const { tx, feePayer } = decoded
      if (feePayer !== treasury.address) return yield* fail("this transaction was not built by Slabwatch")
      const ourSignature = tx.signatures[treasury.address]
      const genuine =
        ourSignature != null &&
        (yield* Effect.promise(() => verifySignature(treasury.keyPair.publicKey, ourSignature, tx.messageBytes)))
      if (!genuine) return yield* fail("this transaction was changed after Slabwatch built it")
      if (!isFullySignedTransaction(tx)) return yield* fail("the wallet has not signed this transaction yet")
      return yield* chain.sendAndConfirm(tx)
    })

    const pay = Effect.fn("Treasury.pay")(function* (from: Address, units: bigint, memo: string) {
      const source = yield* ataOf(from)
      return yield* sendSigned([
        getTransferCheckedInstruction({
          source,
          mint: mint.address,
          destination: escrowAccount,
          authority: delegate,
          amount: units,
          decimals: DUSD_DECIMALS
        }),
        getAddMemoInstruction({ memo })
      ])
    })

    return Treasury.of({
      cluster: chain.cluster,
      addresses: {
        treasury: treasury.address,
        delegate: delegate.address,
        mint: mint.address,
        escrowOwner: escrow.address,
        escrowAccount
      },
      setup,
      funds,
      faucet,
      allowanceTransaction,
      submitSigned,
      pay
    })
  })

export const TreasuryFromKeys = (keys: DevnetKeys) => Layer.effect(Treasury, makeTreasury(keys))
