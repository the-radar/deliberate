#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as os from 'os';
import { ShimGenerator } from '../core/interception/shim-generator';
import { CommandInterceptor } from '../core/interception/interceptor';
import { EnhancedCommandInterceptor } from '../core/interception/interceptor-enhanced';
import { CommandClassifier } from '../core/classification/classifier';
import { UserManager } from '../core/classification/user-manager';
import { Logger } from '../utils/logger';
import * as fs from 'fs/promises';

const logger = new Logger('deliberate-cli');

// Version from package.json
const VERSION = '0.1.0';

// Configuration
const CONFIG_DIR = path.join(os.homedir(), '.deliberate');
const SHIM_DIR = path.join(CONFIG_DIR, 'shims');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.yaml');

class DeliberateCLI {
  private program: Command;
  private shimGenerator: ShimGenerator;
  private interceptor: CommandInterceptor;
  private enhancedInterceptor: EnhancedCommandInterceptor;
  private classifier: CommandClassifier;
  private userManager: UserManager;
  private useAI: boolean = false;

  constructor() {
    this.program = new Command();
    
    // Initialize components
    this.shimGenerator = new ShimGenerator({
      shimDir: SHIM_DIR,
      deliberatePath: process.argv[1] || 'deliberate',
    });
    this.classifier = new CommandClassifier();
    this.userManager = new UserManager(CONFIG_DIR);
    this.interceptor = new CommandInterceptor();
    this.enhancedInterceptor = new EnhancedCommandInterceptor();
    
    // Check if AI mode is enabled
    this.useAI = process.env.DELIBERATE_AI === '1' || false;
  }

  async initialize(): Promise<void> {
    // Ensure config directory exists
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    
    // Load user configuration
    await this.userManager.loadUserConfig();
    await this.classifier.loadUserRules(path.join(CONFIG_DIR, 'user-config.json'));
  }

  setupCommands(): void {
    this.program
      .name('deliberate')
      .description('Intelligent command wrapper for safer system operations')
      .version(VERSION);

    // Install command
    this.program
      .command('install')
      .description('Install Deliberate by setting up PATH shims')
      .option('--force', 'Force reinstall even if already installed')
      .action(async (_options) => {
        try {
          logger.info('Installing Deliberate...');
          
          // Generate and install shims
          const shimCount = await this.shimGenerator.installShims();
          logger.info(`Installed ${shimCount} command shims`);
          
          // Update PATH
          const pathUpdated = await this.updatePATH();
          if (pathUpdated) {
            logger.info('PATH updated successfully');
            logger.info(`\nDeliberate installed! Add this to your shell profile:`);
            logger.info(`export PATH="${SHIM_DIR}:$PATH"`);
          }
          
          logger.info('\nInstallation complete!');
        } catch (error) {
          logger.error('Installation failed:', error);
          process.exit(1);
        }
      });

    // Uninstall command
    this.program
      .command('uninstall')
      .description('Uninstall Deliberate and remove PATH shims')
      .action(async () => {
        try {
          logger.info('Uninstalling Deliberate...');
          
          // Remove shim directory
          await fs.rm(SHIM_DIR, { recursive: true, force: true });
          logger.info('Removed command shims');
          
          logger.info('\nDeliberate uninstalled!');
          logger.info('Remember to remove the PATH export from your shell profile');
        } catch (error) {
          logger.error('Uninstallation failed:', error);
          process.exit(1);
        }
      });

    // Intercept command (called by shims)
    this.program
      .command('intercept <command> [args...]')
      .description('Intercept and analyze a command (internal use)')
      .allowUnknownOption()
      .action(async (command, args) => {
        try {
          await this.initialize();
          
          // Use enhanced interceptor if AI is enabled
          let result;
          if (this.useAI) {
            await this.enhancedInterceptor.initialize();
            result = await this.enhancedInterceptor.intercept(command, args);
          } else {
            result = await this.interceptor.intercept(command, args);
          }
          
          // Exit with the command's exit code
          process.exit(result.exitCode || 0);
        } catch (error) {
          logger.error('Interception failed:', error);
          process.exit(1);
        }
      });

    // Config command
    this.program
      .command('config')
      .description('Manage Deliberate configuration')
      .option('-l, --list', 'List current configuration')
      .option('-s, --safe <command>', 'Add command to safe list')
      .option('-d, --danger <command>', 'Add command to danger list')
      .option('--remove-safe <command>', 'Remove command from safe list')
      .option('--remove-danger <command>', 'Remove command from danger list')
      .option('--export <file>', 'Export rules to file')
      .option('--import <file>', 'Import rules from file')
      .action(async (options) => {
        try {
          await this.initialize();
          
          if (options.list) {
            const config = await this.userManager.exportRules();
            console.log(JSON.stringify(config, null, 2));
          }
          
          if (options.safe) {
            const result = await this.userManager.addToSafeList(options.safe);
            if (result.added) {
              logger.info(`Added '${options.safe}' to safe list`);
            } else {
              logger.error(`Failed to add '${options.safe}': ${result.reason}`);
            }
          }
          
          if (options.danger) {
            const result = await this.userManager.addToDangerList(options.danger);
            if (result.added) {
              logger.info(`Added '${options.danger}' to danger list`);
            } else {
              logger.error(`Failed to add '${options.danger}': ${result.reason}`);
            }
          }
          
          if (options.removeSafe) {
            await this.userManager.removeFromSafeList(options.removeSafe);
            logger.info(`Removed '${options.removeSafe}' from safe list`);
          }
          
          if (options.removeDanger) {
            await this.userManager.removeFromDangerList(options.removeDanger);
            logger.info(`Removed '${options.removeDanger}' from danger list`);
          }
          
          if (options.export) {
            const rules = await this.userManager.exportRules();
            await fs.writeFile(options.export, JSON.stringify(rules, null, 2));
            logger.info(`Exported rules to ${options.export}`);
          }
          
          if (options.import) {
            const data = await fs.readFile(options.import, 'utf-8');
            const rules = JSON.parse(data);
            const result = await this.userManager.importRules(rules, { merge: true });
            if (result.imported) {
              logger.info('Rules imported successfully');
            } else {
              logger.error(`Import failed: ${result.error}`);
            }
          }
        } catch (error) {
          logger.error('Config operation failed:', error);
          process.exit(1);
        }
      });

    // Stats command
    this.program
      .command('stats')
      .description('Show usage statistics and recommendations')
      .action(async () => {
        try {
          await this.initialize();
          
          const stats = await this.userManager.getStats();
          
          console.log('\n=== Deliberate Usage Statistics ===\n');
          console.log(`Total commands: ${stats.totalCommands}`);
          
          if (stats.topCommands && stats.topCommands.length > 0) {
            console.log('\nTop commands:');
            stats.topCommands.forEach((cmd, i) => {
              console.log(`  ${i + 1}. ${cmd.command} (${cmd.count} times)`);
            });
          }
          
          if (stats.recommendations && stats.recommendations.length > 0) {
            console.log('\nRecommendations:');
            stats.recommendations.forEach(rec => {
              console.log(`  • ${rec.command}: ${rec.suggestion}`);
            });
          }
          
          console.log('\n');
        } catch (error) {
          logger.error('Failed to get stats:', error);
          process.exit(1);
        }
      });

    // Status command
    this.program
      .command('status')
      .description('Check Deliberate installation status')
      .action(async () => {
        try {
          console.log('\n=== Deliberate Status ===\n');
          
          // Check if installed
          const shimDirExists = await fs.access(SHIM_DIR).then(() => true).catch(() => false);
          console.log(`Installation: ${shimDirExists ? '✓ Installed' : '✗ Not installed'}`);
          
          if (shimDirExists) {
            const shims = await fs.readdir(SHIM_DIR);
            console.log(`Shim count: ${shims.length}`);
          }
          
          // Check PATH
          const pathContainsShims = process.env.PATH?.includes(SHIM_DIR);
          console.log(`PATH setup: ${pathContainsShims ? '✓ Configured' : '✗ Not configured'}`);
          
          // Check config
          const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
          console.log(`Configuration: ${configExists ? '✓ Found' : '✗ Not found'}`);
          
          // Check AI mode
          console.log(`AI Mode: ${this.useAI ? '✓ Enabled' : '✗ Disabled'}`);
          
          console.log(`\nVersion: ${VERSION}`);
          console.log(`Config directory: ${CONFIG_DIR}`);
          console.log('\n');
        } catch (error) {
          logger.error('Status check failed:', error);
          process.exit(1);
        }
      });
    
    // Agent execution command
    this.program
      .command('agent-exec <authCode>')
      .description('Execute a command using an AI agent auth code')
      .option('--agent-id <id>', 'Agent identifier', 'unknown-agent')
      .action(async (authCode, options) => {
        try {
          if (!this.useAI) {
            logger.error('AI mode must be enabled (set DELIBERATE_AI=1)');
            process.exit(1);
          }
          
          await this.initialize();
          await this.enhancedInterceptor.initialize();
          
          const result = await this.enhancedInterceptor.handleAgentExecution(
            authCode,
            options.agentId
          );
          
          if (!result.allowed) {
            logger.error(`Execution denied: ${result.reason}`);
            process.exit(1);
          }
          
          process.exit(result.exitCode || 0);
        } catch (error) {
          logger.error('Agent execution failed:', error);
          process.exit(1);
        }
      });
    
    // AI mode command
    this.program
      .command('ai')
      .description('Manage AI mode')
      .option('--enable', 'Enable AI mode')
      .option('--disable', 'Disable AI mode')
      .option('--status', 'Check AI status')
      .action(async (options) => {
        try {
          if (options.enable) {
            console.log('To enable AI mode, set DELIBERATE_AI=1 in your environment');
            console.log('Example: export DELIBERATE_AI=1');
          } else if (options.disable) {
            console.log('To disable AI mode, unset DELIBERATE_AI');
            console.log('Example: unset DELIBERATE_AI');
          } else {
            console.log(`AI Mode: ${this.useAI ? 'Enabled' : 'Disabled'}`);
            if (this.useAI) {
              console.log('\nAI Features:');
              console.log('- Local LLM analysis for command safety');
              console.log('- Multi-model consensus system');
              console.log('- Intelligent risk explanations');
              console.log('- Auth codes for AI agent execution');
            }
          }
        } catch (error) {
          logger.error('AI command failed:', error);
          process.exit(1);
        }
      });
  }

  private async updatePATH(): Promise<boolean> {
    // Check if PATH already contains shim directory
    if (process.env.PATH?.includes(SHIM_DIR)) {
      return true;
    }
    
    // Update current process PATH
    process.env.PATH = `${SHIM_DIR}:${process.env.PATH}`;
    
    // Note: User must manually add to shell profile for persistence
    return true;
  }

  async run(): Promise<void> {
    this.setupCommands();
    
    // Parse command line arguments
    this.program.parse(process.argv);
  }
}

// Main entry point
async function main() {
  const cli = new DeliberateCLI();
  await cli.run();
}

// Handle errors
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Run the CLI
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});