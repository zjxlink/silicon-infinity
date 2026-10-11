CREATE TABLE `silicon_chips` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`stable` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text NOT NULL,
	`license` text NOT NULL,
	`visibility` text NOT NULL,
	`latest` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_chip_owner_stable` ON `silicon_chips` (`owner`,`stable`);--> statement-breakpoint
CREATE TABLE `silicon_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`resource` text NOT NULL,
	`user` text NOT NULL,
	`role` text NOT NULL,
	`invite` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_grant_user` ON `silicon_grants` (`kind`,`resource`,`user`);--> statement-breakpoint
CREATE TABLE `silicon_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`kind` text NOT NULL,
	`resource` text NOT NULL,
	`role` text NOT NULL,
	`owner` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_invites_token_unique` ON `silicon_invites` (`token`);--> statement-breakpoint
CREATE TABLE `silicon_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`chip` text NOT NULL,
	`revision` integer NOT NULL,
	`hash` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `silicon_release_version` ON `silicon_releases` (`chip`,`revision`);--> statement-breakpoint
CREATE TABLE `silicon_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`hash` text NOT NULL,
	`response` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `silicon_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`updated` integer NOT NULL
);
