import { formatCards } from "src/card-drafter";

describe("formatCards", () => {
    it("formats a single card as a callout", () => {
        const out = formatCards([{ question: "What is X?", answer: "X is a thing." }]);
        expect(out).toBe("> [!card] What is X?\n> X is a thing.");
    });

    it("prefixes every line of a multi-line answer", () => {
        const out = formatCards([{ question: "Q?", answer: "Line one\nLine two" }]);
        expect(out).toBe("> [!card] Q?\n> Line one\n> Line two");
    });

    it("separates multiple cards with a blank line", () => {
        const out = formatCards([
            { question: "Q1?", answer: "A1" },
            { question: "Q2?", answer: "A2" },
        ]);
        expect(out).toBe("> [!card] Q1?\n> A1\n\n> [!card] Q2?\n> A2");
    });
});
