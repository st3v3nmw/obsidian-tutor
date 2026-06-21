import { scheduleNext, FsrsInput, elapsedDays, currentRecall } from "src/fsrs";

const baseCard = (overrides: Partial<FsrsInput> = {}): FsrsInput => ({
    nextReview: new Date("2026-06-11"),
    interval: 10,
    stability: 10,
    difficulty: 5,
    reps: 3,
    state: "review",
    ...overrides,
});

describe("scheduleNext", () => {
    const now = new Date("2026-06-11");

    it("gives a larger stability bump when a card is recalled late", () => {
        const onTime = scheduleNext(
            baseCard({ lastReview: new Date("2026-06-01") }),
            "good",
            now,
        );
        const late = scheduleNext(
            baseCard({ lastReview: new Date("2026-05-02") }),
            "good",
            now,
        );

        expect(late.stability).toBeGreaterThan(onTime.stability);
    });

    it("honors lastReview rather than forcing elapsed time to zero", () => {
        const withLast = scheduleNext(
            baseCard({ lastReview: new Date("2026-05-02") }),
            "good",
            now,
        );
        const withoutLast = scheduleNext(baseCard(), "good", now);

        expect(withLast.stability).toBeGreaterThan(withoutLast.stability);
    });
});

describe("elapsedDays", () => {
    const now = new Date(2026, 5, 11); // local midnight
    const due = new Date(2026, 5, 21); // interval 10 ahead

    it("uses the stored lastReview when present", () => {
        const lastReview = new Date(2026, 5, 1); // 10 days before now
        expect(elapsedDays(now, due, 10, lastReview)).toBeCloseTo(10, 5);
    });

    it("falls back to due minus interval when lastReview is absent", () => {
        // approx last review = 2026-06-21 - 10 days = 2026-06-11 = now
        expect(elapsedDays(now, due, 10)).toBeCloseTo(0, 5);
    });

    it("never returns a negative value", () => {
        const future = new Date(2026, 6, 1);
        expect(elapsedDays(now, due, 10, future)).toBe(0);
    });
});

describe("currentRecall", () => {
    it("is 1.0 at zero elapsed", () => {
        expect(currentRecall(10, 0)).toBeCloseTo(1, 5);
    });

    it("decreases as elapsed time grows", () => {
        expect(currentRecall(10, 20)).toBeLessThan(currentRecall(10, 5));
    });
});
