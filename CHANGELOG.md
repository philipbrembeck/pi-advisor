# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3]

#### Documentation

- Changed publication flow, no code changes

## [0.1.2]

### Added

- General contextual Advisor reviews: the Executor can call `ask_advisor({})` without a specific question.
- A skill-style Advisor invocation row that distinguishes an Executor request from an Advisor response.
- Markdown rendering support for the Advisor response, including code blocks and inline code.

### Changed

- Advisor responses display the advising model and advice separately from the tool-result payload.
- The Advisor spinner is shown only while a response is streaming and is cleared when the response completes.

## [0.1.1]

### Documentation

- Fixed documentation link

## [0.1.0]

### Added

- Initial npm and git package release.
