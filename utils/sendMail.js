import dotenv from 'dotenv';
dotenv.config();

import { transporter } from "./email.js";

export async function sendResetLink(toEmail, resetLink) {
  const mailOptions = {
    from: `"AYDev Studio Support" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Password Reset - Book Notes",
    html: `
      <p>Hello,</p>
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}">${resetLink}</a>
      <p>If you did not request this, please ignore this email.</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: ", info.response);
  } catch (err) {
    console.error("Error sending email: ", err);
  }
}
