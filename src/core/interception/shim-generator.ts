import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';


export interface ShimConfig {
  shimDir: string;
  deliberatePath: string;
  excludeCommands?: string[];
  includeCommands?: string[];
}

export interface ShimResult {
  command: string;
  shimPath: string;
  created: boolean;
  error?: string;
}

export class ShimGenerator {
  private shimDir: string;
  private deliberatePath: string;
  private excludeCommands: Set<string>;
  private includeCommands: Set<string> | null;

  constructor(config: ShimConfig) {
    this.shimDir = config.shimDir || path.join(os.homedir(), '.deliberate', 'shims');
    this.deliberatePath = config.deliberatePath || 'deliberate';
    this.excludeCommands = new Set(config.excludeCommands || [
      // Never shim these core commands
      'deliberate',
      'sh',
      'bash',
      'zsh',
      'fish',
      'dash',
      'env',
      'which',
      'whereis',
      'type',
    ]);
    this.includeCommands = config.includeCommands ? new Set(config.includeCommands) : null;
  }

  /**
   * Generate shims for all commands in system PATH
   */
  async generateShims(): Promise<ShimResult[]> {
    // Ensure shim directory exists
    await fs.mkdir(this.shimDir, { recursive: true });

    // Get all commands in PATH
    const commands = await this.discoverCommands();
    
    // Filter commands based on include/exclude lists
    const filteredCommands = this.filterCommands(commands);

    // Generate shims for each command
    const results: ShimResult[] = [];
    for (const command of filteredCommands) {
      try {
        const result = await this.createShim(command);
        results.push(result);
      } catch (error) {
        results.push({
          command,
          shimPath: '',
          created: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Install shims by updating PATH environment variable
   */
  async installShims(): Promise<number> {
    // First generate the shims
    const results = await this.generateShims();
    const shimCount = results.filter(r => r.created).length;
    
    // Then update shell config
    // Detect shell and update appropriate config file
    const shell = process.env.SHELL || '/bin/sh';
    const shellName = path.basename(shell);
    
    const configFiles = this.getShellConfigFiles(shellName);
    
    for (const configFile of configFiles) {
      try {
        await this.updateShellConfig(configFile);
      } catch (error) {
        // Continue with other files if one fails
        console.warn(`Failed to update ${configFile}:`, error);
      }
    }
    
    return shimCount;
  }

  /**
   * Update PATH environment variable to include shim directory
   */
  updatePATH(): void {
    const currentPath = process.env.PATH || '';
    const pathEntries = currentPath.split(':');
    
    // Add shim directory to beginning of PATH if not already present
    if (!pathEntries.includes(this.shimDir)) {
      process.env.PATH = `${this.shimDir}:${currentPath}`;
    }
  }

  /**
   * Verify shim installation
   */
  async verifyInstallation(): Promise<boolean> {
    try {
      // Check if shim directory exists
      const stats = await fs.stat(this.shimDir);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check if PATH includes shim directory
      const currentPath = process.env.PATH || '';
      if (!currentPath.includes(this.shimDir)) {
        return false;
      }

      // Test a simple shim
      const testCommand = 'ls';
      const shimPath = path.join(this.shimDir, testCommand);
      
      try {
        await fs.access(shimPath, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Discover all available commands in system PATH
   */
  private async discoverCommands(): Promise<string[]> {
    const commands = new Set<string>();
    const pathDirs = (process.env.PATH || '').split(':').filter(dir => 
      dir && dir !== this.shimDir // Exclude our own shim directory
    );

    for (const dir of pathDirs) {
      try {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          
          try {
            const stats = await fs.stat(filePath);
            
            // Check if file is executable
            if (stats.isFile() && (stats.mode & 0o111)) {
              commands.add(file);
            }
          } catch {
            // Skip files we can't stat
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    return Array.from(commands);
  }

  /**
   * Filter commands based on include/exclude lists
   */
  private filterCommands(commands: string[]): string[] {
    return commands.filter(cmd => {
      // Skip excluded commands
      if (this.excludeCommands.has(cmd)) {
        return false;
      }

      // If include list is specified, only include those commands
      if (this.includeCommands && !this.includeCommands.has(cmd)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Create a shim for a specific command
   */
  private async createShim(command: string): Promise<ShimResult> {
    const shimPath = path.join(this.shimDir, command);
    
    // Generate shim content
    const shimContent = this.generateShimContent(command);
    
    // Write shim file
    await fs.writeFile(shimPath, shimContent, { mode: 0o755 });
    
    return {
      command,
      shimPath,
      created: true,
    };
  }

  /**
   * Generate shim script content
   */
  private generateShimContent(command: string): string {
    // Handle special characters in command name
    const escapedCommand = command.replace(/'/g, "'\\''");
    
    return `#!/bin/sh
# Deliberate command interceptor shim
# Auto-generated - do not edit
# Generated: ${new Date().toISOString()}

# Preserve original command for reference
export DELIBERATE_ORIGINAL_CMD='${escapedCommand}'

# Check if we're already in a deliberate context to prevent loops
if [ -n "$DELIBERATE_INTERCEPTING" ]; then
    # Find and execute the real command
    unset DELIBERATE_INTERCEPTING
    PATH="${process.env.PATH || ''}"
    exec "$(command -v '${escapedCommand}')" "$@"
fi

# Mark that we're intercepting
export DELIBERATE_INTERCEPTING=1

# Execute through deliberate
exec "${this.deliberatePath}" intercept '${escapedCommand}' "$@"
`;
  }

  /**
   * Get shell configuration files based on shell type
   */
  private getShellConfigFiles(shell: string): string[] {
    const home = os.homedir();
    
    switch (shell) {
      case 'bash':
        return [
          path.join(home, '.bashrc'),
          path.join(home, '.bash_profile'),
          path.join(home, '.profile'),
        ];
      case 'zsh':
        return [
          path.join(home, '.zshrc'),
          path.join(home, '.zprofile'),
        ];
      case 'fish':
        return [
          path.join(home, '.config', 'fish', 'config.fish'),
        ];
      default:
        return [
          path.join(home, '.profile'),
        ];
    }
  }

  /**
   * Update shell configuration file to include shim directory in PATH
   */
  private async updateShellConfig(configFile: string): Promise<void> {
    try {
      // Read existing config
      let content = '';
      try {
        content = await fs.readFile(configFile, 'utf-8');
      } catch {
        // File doesn't exist, will create it
      }

      // Check if already configured
      if (content.includes('DELIBERATE_SHIM_PATH')) {
        return;
      }

      // Add deliberate configuration
      const deliberateConfig = `
# Deliberate command interception
export DELIBERATE_SHIM_PATH="${this.shimDir}"
if [[ ":$PATH:" != *":$DELIBERATE_SHIM_PATH:"* ]]; then
    export PATH="$DELIBERATE_SHIM_PATH:$PATH"
fi
`;

      // Append to config file
      await fs.appendFile(configFile, deliberateConfig);
    } catch (error) {
      throw new Error(`Failed to update ${configFile}: ${error}`);
    }
  }

  /**
   * Remove all shims and restore original state
   */
  async uninstall(): Promise<void> {
    // Remove shim directory
    try {
      await fs.rm(this.shimDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }

    // Remove from current PATH
    const currentPath = process.env.PATH || '';
    const pathEntries = currentPath.split(':').filter(dir => dir !== this.shimDir);
    process.env.PATH = pathEntries.join(':');

    // Note: Removing from shell config files is left as manual task
    // to avoid accidentally damaging user configurations
  }
}