import { Card, fsrs, Grade, Rating as FSRSRating, State } from "ts-fsrs";

import { CardState, Rating } from "src/types";

const fsrsInstance = fsrs({
    request_retention: 0.9,
    enable_fuzz: true,
    enable_short_term: false,
});

export interface FsrsInput {
    nextReview: Date;
    lastReview?: Date;
    interval: number;
    stability: number;
    difficulty: number;
    reps: number;
    state: CardState;
}

export interface FsrsResult {
    due: Date;
    stability: number;
    difficulty: number;
    scheduledDays: number;
    reps: number;
    state: CardState;
}

function mapRating(rating: Rating): Grade {
    switch (rating) {
        case "again": return FSRSRating.Again;
        case "hard":  return FSRSRating.Hard;
        case "good":  return FSRSRating.Good;
        case "easy":  return FSRSRating.Easy;
    }
}

function toFSRSState(state: CardState): State {
    switch (state) {
        case "new":        return State.New;
        case "learning":   return State.Learning;
        case "review":     return State.Review;
        case "relearning": return State.Relearning;
    }
}

function fromFSRSState(state: State): CardState {
    switch (state) {
        case State.New:        return "new";
        case State.Learning:   return "learning";
        case State.Review:     return "review";
        case State.Relearning: return "relearning";
    }
}

export function elapsedDays(now: Date, due: Date, interval: number, lastReview?: Date): number {
    const reference = lastReview ?? new Date(due.getTime() - interval * 86400000);
    return Math.max(0, (now.getTime() - reference.getTime()) / 86400000);
}

export function currentRecall(stability: number, elapsed: number): number {
    return Math.pow(1 + (19 / 81) * elapsed / stability, -0.5);
}

export function scheduleNext(card: FsrsInput, rating: Rating, now: Date): FsrsResult {
    const fsrsCard: Card = {
        due: card.nextReview,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: card.interval,
        scheduled_days: card.interval,
        learning_steps: 0,
        reps: card.reps,
        lapses: 0,
        state: toFSRSState(card.state),
        last_review: card.lastReview,
    };

    const result = fsrsInstance.next(fsrsCard, now, mapRating(rating));
    const next = result.card;

    return {
        due: next.due,
        stability: next.stability,
        difficulty: next.difficulty,
        scheduledDays: Math.max(1, next.scheduled_days),
        reps: next.reps,
        state: fromFSRSState(next.state),
    };
}
