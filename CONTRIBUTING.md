# Contributing

Thanks for taking a look. Slabwatch is my personal study project, and I am not taking outside contributions.

- **Pull requests** from anyone other than the maintainer are closed without review, however good they are. Please don't open one.
- **Issues** are open for bug reports about the code or the live demo. Fixes are best effort, and feature requests are out of scope.
- **Security problems** never go in an issue. Follow [SECURITY.md](SECURITY.md) to report them privately.
- **Forks** are welcome. The code is under the [MIT license](LICENSE), so you can fork it and change it as you like.

Please follow the [code of conduct](CODE_OF_CONDUCT.md) wherever you interact with this project.

## How changes land

Every change, the maintainer's included, takes the same path:

1. A branch and a pull request against `main`. Direct pushes to `main` are blocked.
2. CI has to pass: the gitleaks secret scan, typecheck, tests, the web build, an offline eval check, and a migrate and seed from scratch. CodeQL scans the pull request too.
3. The branch is deleted after the merge.

To run the project yourself, see [Run it locally](README.md#run-it-locally).
