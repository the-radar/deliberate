
interface AuthData {
  command: string;
  args: string[];
  analysis: any;
  timestamp: number;
  used: boolean;
}

export class AgentAuthSystem {
  private authCodes = new Map<string, AuthData>();
  private codeExpiry = 5 * 60 * 1000; // 5 minutes
  
  // Word lists for readable codes
  private adjectives = [
    'swift', 'brave', 'bright', 'calm', 'clear',
    'cool', 'eager', 'fair', 'fast', 'free',
    'glad', 'good', 'grand', 'great', 'green',
    'happy', 'kind', 'light', 'neat', 'nice',
    'proud', 'pure', 'quick', 'sharp', 'smart',
    'solid', 'sound', 'strong', 'sweet', 'true'
  ];
  
  private nouns = [
    'apple', 'arrow', 'badge', 'beach', 'bird',
    'block', 'boat', 'book', 'brain', 'bread',
    'brick', 'brush', 'cake', 'chair', 'clock',
    'cloud', 'coin', 'crown', 'desk', 'door',
    'eagle', 'earth', 'field', 'fire', 'flag',
    'flower', 'forest', 'game', 'gate', 'glass'
  ];
  
  generateAuthCode(command: string, args: string[], analysis: any): string {
    // Generate readable but secure code
    const code = this.generateReadableCode();
    
    this.authCodes.set(code, {
      command,
      args,
      analysis,
      timestamp: Date.now(),
      used: false
    });
    
    // Schedule cleanup
    setTimeout(() => {
      this.authCodes.delete(code);
    }, this.codeExpiry);
    
    return code;
  }
  
  validateAuthCode(code: string): { valid: boolean; data?: AuthData; reason?: string } {
    const authData = this.authCodes.get(code);
    
    if (!authData) {
      return { valid: false, reason: 'Invalid or expired auth code' };
    }
    
    if (authData.used) {
      return { valid: false, reason: 'Auth code already used' };
    }
    
    if (Date.now() - authData.timestamp > this.codeExpiry) {
      this.authCodes.delete(code);
      return { valid: false, reason: 'Auth code expired' };
    }
    
    // Mark as used
    authData.used = true;
    
    return { valid: true, data: authData };
  }
  
  private generateReadableCode(): string {
    const adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
    const noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
    const num = Math.floor(Math.random() * 100);
    
    return `${adj}-${noun}-${num}`;
  }
  
  // Clean up expired codes
  cleanup(): void {
    const now = Date.now();
    for (const [code, data] of this.authCodes) {
      if (now - data.timestamp > this.codeExpiry) {
        this.authCodes.delete(code);
      }
    }
  }
  
  // Get active codes count (for monitoring)
  getActiveCodesCount(): number {
    this.cleanup();
    return this.authCodes.size;
  }
}