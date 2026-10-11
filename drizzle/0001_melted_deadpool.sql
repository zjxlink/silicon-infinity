CREATE TABLE `silicon_challenge_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`revision` integer NOT NULL,
	`hash` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_challenge_release_version` ON `silicon_challenge_releases` (`challenge`,`revision`);--> statement-breakpoint
CREATE TABLE `silicon_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`stable` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`license` text NOT NULL,
	`visibility` text NOT NULL,
	`latest` integer NOT NULL,
	`source` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_challenge_owner_stable` ON `silicon_challenges` (`owner`,`stable`);