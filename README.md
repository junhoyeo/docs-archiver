# Docs Archiver

![Docs Archiver](./.github/cover.jpg)

> A TypeScript-based tool that archives documentation websites into clean markdown files using Anthropic API

## Setup

1. Install dependencies:
    ```bash
    yarn
    ```

2. Set up configuration:
    ```bash
    cp .env.example .env
    # Edit .env and configure:
    # - ANTHROPIC_API_KEY (required)
    # - BASE_URL (documentation site base URL)
    # - START_URL (starting page for crawling)
    ```

Or export directly:
```bash
export ANTHROPIC_API_KEY=your_api_key_here
export BASE_URL=https://docs.yoursite.com
export START_URL=https://docs.yoursite.com/getting-started
```

## Usage

Run the archiver:
```bash
yarn start
```

### Options

- `--skip-existing` or `-s`: Skip pages that are already archived
- `--base-url <url>`: Override base URL for the documentation site
- `--start-url <url>`: Override starting URL for crawling  
- `--help` or `-h`: Show help message

Examples:
```bash
# Use environment variables
yarn start

# Skip already archived pages (useful for resuming interrupted runs)
yarn start --skip-existing

# Override URLs via CLI
yarn start --base-url https://docs.mysite.com --start-url https://docs.mysite.com/intro

# Combine options
yarn start --skip-existing --base-url https://docs.mysite.com --start-url https://docs.mysite.com/intro
```

This will:
- Crawl the documentation starting from your configured START_URL
- Extract content from Next.js `__NEXT_DATA__` compiled source
- Use Anthropic's API to convert compiled React/MDX to clean markdown
- Save archived pages to `./archived-docs/` directory

## Features

- Extracts content from Next.js applications using `__NEXT_DATA__`
- Uses Anthropic SDK to clean up compiled source code into readable markdown
- Crawls links automatically to archive entire documentation sites
- Adds frontmatter with original URL and archive timestamp
- Rate limiting to be respectful to the target server
