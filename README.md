
<img src="logo.png" width="100px" />

# PostHog Plugin: Migrator 3000 

This plugin allows you to migrate events from one PostHog instance to another. You can migrate between self-hosted instances, or from a self-hosted instance to PostHog Cloud (and vice-versa).

**Please note that this plugin will only migrate events and objects derived from events such as persons. Dashboards, insights, feature flags, etc. will not be migrated.**

## Installation

### Self-hosted

Search for this plugin on the "Repository" tab of the plugins page (/plugins) and install it.

### PostHog Cloud

This plugin will already be installed. Enable it from your plugins page.

## Configuration

### Host

Host of your PostHog instance (without `http` or `https`). Set this to `app.posthog.com` if migrating _to_ PostHog Cloud.

### Project API Key

Project API key (token) of the instance you wish to migrate to.

### Date to start exporting from

Use format YYYY-MM-DD.

### PostHog version

Self-hosted users can find their PostHog version from `/instance/status`

