import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Database tests create their own schemas; running files one at a time
    // avoids racing on CREATE EXTENSION in a fresh database.
    fileParallelism: false
  }
})
