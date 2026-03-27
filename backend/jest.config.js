export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  preserveSymlinks: true,
  transform: {
    "^.+\\.js$": "babel-jest"
  },
  verbose: true,
  openHandlesTimeout: 5000,
  forceExit: true,
};