#!/usr/bin/env node

import { SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import fs from 'fs';
import { stgen } from './generator';
import yargs from 'yargs';

const argv = yargs
  .option('outputDir', {
    alias: 'o',
    description: 'Output directory for generated typescript files',
    type: 'string',
    default: 'stgen',
    normalize: true,
  })
  .option('token', {
    alias: 't',
    description: 'Access token for SmartThings',
    type: 'string',
  })
  .option('tokenFile', {
    alias: 'i',
    description: 'Path to file containing access token for SmartThings',
    type: 'string',
    normalize: true,
  })
  .conflicts('token', 'tokenFile')
  .help()
  .alias('help', 'h')
  .check(argv => {
    if (argv.token && argv.tokenFile) {
      throw new Error('Only one of token and tokenFile can be specified.');
    }
    if (!argv.token && !argv.tokenFile) {
      throw new Error('At least one of token or tokenFile must be specified.');
    }
    return true;
  }).argv;

const token = argv.token || fs.readFileSync(argv.tokenFile!, 'utf-8');
const client = new SmartThingsClient(new BearerTokenAuthenticator(token));

stgen(client, { outputDir: argv.outputDir });
