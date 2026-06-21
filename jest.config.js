module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    moduleNameMapper: {
        "^src/(.*)$": "<rootDir>/src/$1",
        "^obsidian$": "<rootDir>/test/__mocks__/obsidian.ts",
    },
};
