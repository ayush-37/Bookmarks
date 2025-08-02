// email.js
import nodemailer from "nodemailer";
import dotenv from 'dotenv';
dotenv.config();

export const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,   // this must NOT be undefined
    pass: process.env.EMAIL_PASS,   // this must be your app password
  },
});
