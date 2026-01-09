import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../utils/logger';

export interface ShellFunctionConfig {
  deliberatePath: string;
  stateFile: string;
}

export class ShellFunctionManager {
  private logger = new Logger('shell-function-manager');
  private deliberatePath: string;
  private stateFile: string;
  private functionFile: string;
  
  // Dangerous commands that need protection
  private readonly DANGEROUS_COMMANDS = [
    'rm',
    'dd',
    'sudo',
    'chmod',
    'chown',
    'mkfs',
    'fdisk',
    'mv',  // When moving to dangerous locations
    'cp',  // When overwriting important files
  ];

  constructor(config: ShellFunctionConfig) {
    this.deliberatePath = config.deliberatePath;
    this.stateFile = config.stateFile;
    this.functionFile = path.join(path.dirname(config.stateFile), 'shell-functions.sh');
    
    // In test mode, use test directory paths
    if (process.env.DELIBERATE_TEST_MODE === '1' && process.env.DELIBERATE_TEST_DIR) {
      this.stateFile = path.join(process.env.DELIBERATE_TEST_DIR, 'state');
      this.functionFile = path.join(process.env.DELIBERATE_TEST_DIR, 'shell-functions.sh');
    }
  }

  /**
   * Install Deliberate without shims - just create state and function files
   */
  async install(): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    
    // Set initial state to OFF
    await this.setState('INACTIVE');
    
    // Create shell functions file
    await this.generateShellFunctions();
    
    this.logger.info('Deliberate installed - use "deliberate on" to enable protection');
  }

  /**
   * Enable protection by sourcing shell functions
   */
  async enable(): Promise<void> {
    await this.setState('ACTIVE');
    
    // Generate instructions for user's shell
    const instructions = this.getActivationInstructions();
    console.log(instructions);
  }

  /**
   * Disable protection
   */
  async disable(): Promise<void> {
    await this.setState('INACTIVE');
    
    // Generate instructions for deactivation
    const instructions = this.getDeactivationInstructions();
    console.log(instructions);
  }

  /**
   * Get current state
   */
  async getState(): Promise<'ACTIVE' | 'INACTIVE'> {
    try {
      const state = await fs.readFile(this.stateFile, 'utf8');
      return state.trim() as 'ACTIVE' | 'INACTIVE';
    } catch {
      return 'INACTIVE';
    }
  }

  /**
   * Check if Deliberate is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      await fs.access(this.stateFile);
      await fs.access(this.functionFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Uninstall Deliberate
   */
  async uninstall(): Promise<void> {
    try {
      await fs.unlink(this.stateFile);
      await fs.unlink(this.functionFile);
      
      // Note: We don't remove the config directory as it may contain user data
      this.logger.info('Deliberate uninstalled');
    } catch (error) {
      // Files might not exist
      this.logger.debug('Uninstall cleanup:', error);
    }
  }

  /**
   * Generate shell functions for dangerous commands
   */
  private async generateShellFunctions(): Promise<void> {
    const functions = this.DANGEROUS_COMMANDS.map(cmd => `
# Deliberate wrapper for ${cmd}
${cmd}() {
  if [ "$(cat ${this.stateFile} 2>/dev/null)" = "ACTIVE" ]; then
    node "${this.deliberatePath}" intercept ${cmd} "$@"
  else
    command ${cmd} "$@"
  fi
}`).join('\n');

    const content = `#!/bin/bash
# Deliberate shell functions
# Source this file to enable command protection

${functions}

# Helper function to check Deliberate state
deliberate_status() {
  local state=$(cat ${this.stateFile} 2>/dev/null || echo "INACTIVE")
  if [ "$state" = "ACTIVE" ]; then
    echo "✅ Deliberate protection: ACTIVE"
  else
    echo "🔓 Deliberate protection: INACTIVE"
  fi
}
`;

    await fs.writeFile(this.functionFile, content, { mode: 0o644 });
  }

  /**
   * Set state
   */
  private async setState(state: 'ACTIVE' | 'INACTIVE'): Promise<void> {
    await fs.writeFile(this.stateFile, state, 'utf8');
  }

  /**
   * Get shell activation instructions
   */
  private getActivationInstructions(): string {
    const shell = path.basename(process.env.SHELL || 'bash');
    
    return `✅ Deliberate protection enabled

To activate in your current shell:
  source ~/.deliberate/shell-functions.sh

To activate permanently, add to your shell profile (~/.${shell}rc):
  source ~/.deliberate/shell-functions.sh

Protected commands: ${this.DANGEROUS_COMMANDS.join(', ')}`;
  }

  /**
   * Get shell deactivation instructions
   */
  private getDeactivationInstructions(): string {
    const unsetCommands = this.DANGEROUS_COMMANDS.map(cmd => `unset -f ${cmd}`).join('; ');
    
    return `🔓 Deliberate protection disabled

To deactivate in your current shell:
  ${unsetCommands}

To check status:
  deliberate status`;
  }
}