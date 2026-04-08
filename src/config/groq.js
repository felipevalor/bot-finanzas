// src/config/groq.js
import Groq from 'groq-sdk';
import config from './env.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

export default groq;
