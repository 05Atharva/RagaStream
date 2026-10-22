// Gmail SMTP through nodemailer. Port 465 (implicit TLS): Supabase blocks 25 and 587.
import nodemailer from "npm:nodemailer@6.9.16";
import { requireEnv } from "./env.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Shape of the credentials, safe to log: no characters of either value. */
export function credentialShape(rawUser: string, rawPass: string): string {
  const user = rawUser.trim();
  const pass = rawPass.replace(/\s+/g, "");
  const domain = user.includes("@") ? user.split("@").pop() : "(no @)";
  return `user: ${user.length} chars @${domain}${rawUser !== user ? " (had surrounding spaces)" : ""}; ` +
    `app password: ${pass.length} chars${rawPass !== pass ? " (had spaces, removed)" : ""}${pass.length === 16 ? "" : " (expected 16)"}`;
}

export async function sendMail(mail: Mail): Promise<void> {
  // Pasted secrets often carry a trailing newline, and Google shows app passwords
  // as four groups ("abcd efgh ijkl mnop"); Gmail wants the 16 letters only.
  const rawUser = requireEnv("GMAIL_USER");
  const rawPass = requireEnv("GMAIL_APP_PASSWORD");
  const user = rawUser.trim();
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: rawPass.replace(/\s+/g, "") },
  });
  console.log("mail: sending with", credentialShape(rawUser, rawPass));
  try {
    await transport.sendMail({
      from: `RagaStream <${user}>`,
      to: mail.to,
      subject: mail.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
      text: mail.text,
      html: mail.html,
    });
  } finally {
    transport.close();
  }
}
