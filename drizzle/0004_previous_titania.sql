CREATE INDEX `idx_letter_requests_status` ON `letter_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_letter_requests_user_id` ON `letter_requests` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_letter_requests_assigned_reviewer` ON `letter_requests` (`assignedReviewerId`);--> statement-breakpoint
CREATE INDEX `idx_letter_versions_letter_request_id` ON `letter_versions` (`letterRequestId`);--> statement-breakpoint
CREATE INDEX `idx_research_runs_letter_request_status` ON `research_runs` (`letterRequestId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_review_actions_letter_request_id` ON `review_actions` (`letterRequestId`);--> statement-breakpoint
CREATE INDEX `idx_workflow_jobs_letter_request_status` ON `workflow_jobs` (`letterRequestId`,`status`);