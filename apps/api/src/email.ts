export interface InvitationEmail { to: string; groupName: string; url: string }
export interface EmailProvider { sendInvitation(message: InvitationEmail): Promise<void> }

// Development mailbox only. Production must never log invitation URLs.
export class ConsoleEmailProvider implements EmailProvider {
  async sendInvitation(message: InvitationEmail) {
    console.log(JSON.stringify({ event: 'development_email', ...message }));
  }
}
export class ResendEmailProvider implements EmailProvider {
  constructor(private apiKey: string, private from: string) {}
  async sendInvitation(message: InvitationEmail) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: 'Your Leadership DNA invitation',
        text: `You have been invited to ${message.groupName}. Join using this private link (expires in 7 days):\n\n${message.url}\n\nIf you did not expect this invitation, you can ignore it.` }),
    });
    if (!response.ok) throw new Error('Invitation delivery failed');
  }
}
