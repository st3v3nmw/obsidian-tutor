import { App, Notice } from "obsidian";
import { Card, fsrs, Grade, Rating as FSRSRating, State } from "ts-fsrs";

import TutorPlugin from "src/main";
import { Rating, TopicCard } from "src/types";

export class TopicManager {
    private app: App;
    private plugin: TutorPlugin;
    private fsrsInstance = fsrs({
      request_retention: 0.9,
      enable_fuzz: true,
      enable_short_term: false
    });

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
                    let rating: Rating | undefined = undefined;
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
                                rating = data[1] as Rating;
                                interval = parseInt(data[2]);
                                stability = parseFloat(data[3]);
                                difficulty = parseFloat(data[4]);
                                reps = parseInt(data[5]);
                            }

                            i++;
                        }
                    }

                    // Use entire note as context - user can place callout anywhere
                    const context = content;

                    topics.push({
                        name: topicName,
                        file,
                        content: context,
                        nextReview,
                        rating,
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

    mapRatingToFSRSRating(rating: Rating): Grade {
        switch (rating) {
            case "again": return FSRSRating.Again;
            case "hard": return FSRSRating.Hard;
            case "good": return FSRSRating.Good;
            case "easy": return FSRSRating.Easy;
        }
    }

    async updateTopicInNote(topic: TopicCard, newRating: Rating) {
        // Create FSRS card from current state
        const card: Card = {
            due: topic.nextReview,
            stability: topic.stability,
            difficulty: topic.difficulty,
            elapsed_days: topic.interval, // TODO: Remove once dropped by FSRS
            scheduled_days: topic.interval,
            learning_steps: 0,
            reps: topic.reps,
            lapses: 0,
            state: topic.reps === 0 ? State.New : State.Review
        };

        // Get new card state from FSRS
        const grade = this.mapRatingToFSRSRating(newRating);
        const result = this.fsrsInstance.next(card, new Date(), grade);
        const newCard = result.card;

        // Update inline comment in file
        const content = await this.app.vault.read(topic.file);
        const lines = content.split("\n");
        let updated = false;

        const nextReviewDate = newCard.due.toISOString().split("T")[0];
        const scheduledDays = Math.max(1, newCard.scheduled_days);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const topicMatch = line.match(/^>\s*\[!topic\]\s*(.+)$/);

            if (topicMatch && topicMatch[1].trim() === topic.name) {
                // Format: nextReview,rating,interval,stability,difficulty,reps
                const dataComment = `> <!--${nextReviewDate},${newRating},${scheduledDays},${newCard.stability.toFixed(1)},${newCard.difficulty.toFixed(1)},${newCard.reps}-->`;

                // Check if next line is already a data comment
                if (i + 1 < lines.length && lines[i + 1].match(/^>\s*<!--(.+)-->$/)) {
                    lines[i + 1] = dataComment;
                } else {
                    // Insert new data comment
                    lines.splice(i + 1, 0, dataComment);
                }

                updated = true;
                break;
            }
        }

        if (updated) {
            await this.app.vault.modify(topic.file, lines.join("\n"));
            new Notice(`Updated ${topic.name} - next review: ${nextReviewDate}`);
        } else {
            new Notice(`Error: Could not find topic "${topic.name}" in file`);
        }
    }
}
