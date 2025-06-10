import 'dotenv/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

interface NavigationGroup {
  group: string;
  pages: (string | NavigationGroup)[];
}

interface NavigationTab {
  tab: string;
  groups: NavigationGroup[];
}

interface Navigation {
  tabs: NavigationTab[];
  global?: {
    anchors: Array<{
      anchor: string;
      href: string;
      icon: string;
    }>;
  };
}

interface NextData {
  props: {
    pageProps: {
      mdxSource?: {
        compiledSource: string;
        scope?: {
          config?: {
            navigation?: Navigation;
          };
        };
      };
    };
  };
}

interface ArchiverOptions {
  skipExisting?: boolean;
  baseUrl?: string;
  outputDir?: string;
}

class DocsArchiver {
  private anthropic: Anthropic;
  private visitedUrls: Set<string> = new Set();
  private baseUrl: string;
  private outputDir: string;
  private skipExisting: boolean;

  constructor(options: ArchiverOptions = {}) {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
    this.baseUrl = options.baseUrl || process.env.BASE_URL || 'https://docs.example.com';
    this.outputDir = options.outputDir || './archived-docs';
    this.skipExisting = options.skipExisting || false;
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async extractNextData(html: string): Promise<NextData | null> {
    try {
      const scriptRegex = /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s;
      const match = html.match(scriptRegex);
      
      if (!match) {
        console.log('No __NEXT_DATA__ found');
        return null;
      }

      return JSON.parse(match[1]);
    } catch (error) {
      console.error('Error parsing __NEXT_DATA__:', error);
      return null;
    }
  }

  async convertCompiledSourceToMarkdown(compiledSource: string): Promise<string> {
    try {
      const message = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Convert this compiled React/MDX source code to clean markdown format. Extract the main content and remove any React/JSX syntax, keeping only the readable documentation content:\n\n${compiledSource}`
        }]
      });

      const content = message.content[0];
      return content.type === 'text' ? content.text : '';
    } catch (error) {
      console.error('Error converting with Anthropic:', error);
      return compiledSource;
    }
  }

  async fetchAndParsePage(url: string): Promise<{ content: string; nextData: NextData } | null> {
    try {
      console.log(`Fetching: ${url}`);
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const nextData = await this.extractNextData(response.data);
      
      if (!nextData?.props?.pageProps?.mdxSource?.compiledSource) {
        console.log(`No MDX source found for ${url}`);
        return null;
      }

      const markdown = await this.convertCompiledSourceToMarkdown(
        nextData.props.pageProps.mdxSource.compiledSource
      );

      return { content: markdown, nextData };
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      return null;
    }
  }

  getFileNameForUrl(url: string): string {
    const urlPath = new URL(url).pathname;
    return urlPath === '/' || urlPath === '/starthere' 
      ? 'index.md' 
      : `${urlPath.replace(/\//g, '_')}.md`;
  }

  isPageAlreadyArchived(url: string): boolean {
    if (!this.skipExisting) return false;
    
    const fileName = this.getFileNameForUrl(url);
    const filePath = path.join(this.outputDir, fileName);
    return fs.existsSync(filePath);
  }

  async savePage(url: string, content: string): Promise<void> {
    const fileName = this.getFileNameForUrl(url);
    const filePath = path.join(this.outputDir, fileName);
    
    const frontMatter = `---
url: ${url}
archived_at: ${new Date().toISOString()}
---

`;

    fs.writeFileSync(filePath, frontMatter + content);
    console.log(`Saved: ${filePath}`);
  }

  extractNavigationPages(navigation: Navigation): string[] {
    const pages: string[] = [];
    
    const extractFromGroup = (group: NavigationGroup): void => {
      group.pages.forEach(page => {
        if (typeof page === 'string') {
          pages.push(page);
        } else {
          extractFromGroup(page);
        }
      });
    };

    navigation.tabs.forEach(tab => {
      tab.groups.forEach(group => {
        extractFromGroup(group);
      });
    });

    return pages;
  }

  async findLinksFromNavigation(nextData: NextData): Promise<string[]> {
    const links: string[] = [];
    const navigation = nextData.props.pageProps.mdxSource?.scope?.config?.navigation;
    
    if (navigation) {
      const pages = this.extractNavigationPages(navigation);
      pages.forEach(page => {
        const fullUrl = `${this.baseUrl}/${page}`;
        if (!this.visitedUrls.has(fullUrl)) {
          links.push(fullUrl);
        }
      });
    }

    return links;
  }

  async findLinksInContent(content: string): Promise<string[]> {
    const links: string[] = [];
    const linkRegex = /href=["']([^"']*?)["']/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const link = match[1];
      if (link.startsWith('/') && !link.startsWith('//')) {
        const fullUrl = `${this.baseUrl}${link}`;
        if (!this.visitedUrls.has(fullUrl)) {
          links.push(fullUrl);
        }
      }
    }

    return links;
  }

  async crawlAndArchive(startUrl: string): Promise<void> {
    const queue: string[] = [startUrl];
    let navigationLinksExtracted = false;
    
    while (queue.length > 0) {
      const currentUrl = queue.shift()!;
      
      if (this.visitedUrls.has(currentUrl)) {
        continue;
      }
      
      // Check if page is already archived
      if (this.isPageAlreadyArchived(currentUrl)) {
        console.log(`Skipping already archived: ${currentUrl}`);
        this.visitedUrls.add(currentUrl);
        
        // If this is the start page and we haven't extracted navigation yet, 
        // we still need to fetch it to get the navigation structure
        if (currentUrl === startUrl && !navigationLinksExtracted) {
          console.log('Fetching navigation from start page...');
          const result = await this.fetchAndParsePage(currentUrl);
          if (result) {
            const navigationLinks = await this.findLinksFromNavigation(result.nextData);
            console.log(`Found ${navigationLinks.length} navigation links`);
            queue.push(...navigationLinks);
            navigationLinksExtracted = true;
          }
        }
        continue;
      }
      
      this.visitedUrls.add(currentUrl);
      
      const result = await this.fetchAndParsePage(currentUrl);
      
      if (result) {
        await this.savePage(currentUrl, result.content);
        
        // Extract navigation links from the first page
        if (currentUrl === startUrl && !navigationLinksExtracted) {
          const navigationLinks = await this.findLinksFromNavigation(result.nextData);
          console.log(`Found ${navigationLinks.length} navigation links`);
          queue.push(...navigationLinks);
          navigationLinksExtracted = true;
        }
        
        // Also find links in content as fallback
        const contentLinks = await this.findLinksInContent(result.content);
        queue.push(...contentLinks);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options: ArchiverOptions = {};
  let startUrl = process.env.START_URL || 'https://docs.example.com/getting-started';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--skip-existing':
      case '-s':
        options.skipExisting = true;
        break;
      case '--base-url':
        if (i + 1 < args.length) {
          options.baseUrl = args[++i];
        } else {
          console.error('--base-url requires a URL argument');
          process.exit(1);
        }
        break;
      case '--start-url':
        if (i + 1 < args.length) {
          startUrl = args[++i];
        } else {
          console.error('--start-url requires a URL argument');
          process.exit(1);
        }
        break;
      case '--help':
      case '-h':
        console.log(`
Usage: yarn start [options]

Options:
  --skip-existing, -s           Skip pages that are already archived
  --base-url <url>             Base URL for the documentation site
  --start-url <url>            Starting URL for crawling
  --help, -h                   Show this help message

Environment Variables:
  ANTHROPIC_API_KEY            Required: Your Anthropic API key
  BASE_URL                     Default base URL for the documentation site
  START_URL                    Default starting URL for crawling

Examples:
  yarn start                                    # Use environment variables
  yarn start --skip-existing                   # Skip already archived pages
  yarn start --base-url https://docs.mysite.com --start-url https://docs.mysite.com/intro
`);
        process.exit(0);
        break;
    }
  }

  return { options, startUrl };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Please set ANTHROPIC_API_KEY environment variable');
    process.exit(1);
  }

  const { options, startUrl } = parseArgs();
  
  const archiver = new DocsArchiver(options);
  
  if (options.skipExisting) {
    console.log('Skip existing mode enabled - will skip already archived pages');
  }
  
  console.log(`Base URL: ${options.baseUrl || process.env.BASE_URL || 'https://docs.example.com'}`);
  console.log(`Start URL: ${startUrl}`);
  
  await archiver.crawlAndArchive(startUrl);
  
  console.log('Archiving completed!');
}

main().catch(console.error);