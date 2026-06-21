export interface DraftCard {
    question: string;
    answer: string;
}

export const DRAFT_SCHEMA = {
    type: "json_schema",
    json_schema: {
        name: "card_drafts",
        strict: true,
        schema: {
            type: "object",
            properties: {
                cards: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            question: { type: "string" },
                            answer: { type: "string" },
                        },
                        required: ["question", "answer"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["cards"],
            additionalProperties: false,
        },
    },
};

const DRAFT_SYSTEM_PROMPT = `\
You turn a passage from the user's notes into spaced repetition cards.
The passage is the user's message.

## Grounding

Every question and answer must come strictly from the passage. Use only
what it states or directly entails. Do not add facts, examples, or
detail it does not contain. If the passage doesn't hold enough for a
worthwhile card, return fewer cards, or none at all.

## Cards

Produce one to three cards, one per distinct idea the passage develops.
A good card asks for understanding, not trivia: the question names the
concept, the answer explains it in prose that shows the reasoning rather
than listing conclusions. Keep each card to a single concept; a concept
with several necessary parts stays one card. Each answer is the only
ground truth a later grader checks against, so it must stand on its own
without the passage in view.

## Style

Write like a knowledgeable peer. Prose over lists. Vary sentence length:
short sentences land hard, longer ones build and release.

No em-dashes or double hyphens. Avoid AI vocabulary: pivotal, robust,
foster, showcase, underscore, delve, bolster, crucial, testament,
enhance, and similar words that assert without demonstrating.

Write in American English. Format answers in Markdown.`;

export function buildDraftMessages(selection: string): { role: string; content: string }[] {
    return [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: selection },
    ];
}

export function formatCards(cards: DraftCard[]): string {
    return cards.map(formatCard).join("\n\n");
}

function formatCard(card: DraftCard): string {
    const body = card.answer.split("\n").map(l => `> ${l}`).join("\n");
    return `> [!card] ${card.question}\n${body}`;
}
