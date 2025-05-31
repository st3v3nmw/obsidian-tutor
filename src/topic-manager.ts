import { App, Notice } from "obsidian";
import { Card, fsrs, Grade, Rating, State } from "ts-fsrs";

import TutorPlugin from "src/main";
import { TopicCard } from "src/types";

export class TopicManager {
    private app: App;
    private plugin: TutorPlugin;
    private fsrsInstance = fsrs();

    constructor(app: App, plugin: TutorPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async getAllTopics(): Promise<TopicCard[]> {
        const topics: TopicCard[] = [];
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const content = await this.app.vault.read(file);
            const lines = content.split("\n");

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const topicMatch = line.match(/^>\s*\[!topic\]\s*(.+)$/);

                if (topicMatch) {
                    const topicName = topicMatch[1].trim();

                    // Look for data comment on next line
                    let nextReview = new Date();
                    let score = 0.5;
                    let interval = 1;
                    let stability = 2.5;
                    let difficulty = 5.0;
                    let reps = 0;

                    if (i + 1 < lines.length) {
                        const dataMatch = lines[i + 1].match(/^>\s*<!--(.+)-->$/);
                        if (dataMatch) {
                            const data = dataMatch[1].split(",");
                            if (data.length === 6) {
                                nextReview = new Date(data[0]);
                                score = parseFloat(data[1]);
                                interval = parseInt(data[2]);
                                stability = parseFloat(data[3]);
                                difficulty = parseFloat(data[4]);
                                reps = parseInt(data[5]);
                            }
                        }
                    }

                    // Use entire note as context - user can place callout anywhere
                    const context = content;

                    topics.push({
                        name: topicName,
                        file,
                        content: context,
                        nextReview,
                        score,
                        interval,
                        stability,
                        difficulty,
                        reps
                    });
                }
            }
        }

        return topics;
    }

    async getDueTopics(): Promise<TopicCard[]> {
        const allTopics = await this.getAllTopics();
        const now = new Date();
        return allTopics.filter(topic => topic.nextReview <= now);
    }

    mapScoreToGrade(score: number): Grade {
        if (score < 0.3) return Rating.Again;
        if (score < 0.6) return Rating.Hard;
        if (score < 0.8) return Rating.Good;
        return Rating.Easy;
    }

    async updateTopicInNote(topic: TopicCard, newScore: number) {
        // Create FSRS card from current state
        const card: Card = {
            due: topic.nextReview,
            stability: topic.stability,
            difficulty: topic.difficulty,
            elapsed_days: topic.interval,
            scheduled_days: topic.interval,
            learning_steps: 0,
            reps: topic.reps,
            lapses: 0,
            state: State.Review
        };

        // Get new card state from FSRS
        const rating = this.mapScoreToGrade(newScore);
        const result = this.fsrsInstance.next(card, new Date(), rating);
        const newCard = result.card;

        // Read current file content
        const content = await this.app.vault.read(topic.file);
        const lines = content.split("\n");

        // Find the topic callout by matching the exact topic name
        const topicPattern = `> [!topic] ${topic.name}`;
        const topicLineIndex = lines.findIndex(line => line.trim() === topicPattern.trim());

        if (topicLineIndex === -1) {
            new Notice(`Could not find topic "${topic.name}" in note ${topic.file.basename}`);
            return;
        }

        // Format new data comment
        const nextReview = newCard.due.toISOString().split("T")[0];
        const newDataComment = `> <!--${nextReview},${newScore.toFixed(2)},${newCard.scheduled_days},${newCard.stability.toFixed(1)},${newCard.difficulty.toFixed(1)},${newCard.reps}-->`;

        // Update or add data comment
        if (topicLineIndex + 1 < lines.length && lines[topicLineIndex + 1].match(/^>\s*<!--(.+)-->$/)) {
            lines[topicLineIndex + 1] = newDataComment;
        } else {
            lines.splice(topicLineIndex + 1, 0, newDataComment);
        }

        // Write back to file
        const newContent = lines.join("\n");
        await this.app.vault.modify(topic.file, newContent);

        new Notice(`Updated ${topic.name} - next review: ${nextReview}`);
    }
}
