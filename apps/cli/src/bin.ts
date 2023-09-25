#!/usr/bin/env node

import { watch } from 'chokidar';
import { Command } from 'commander';
import 'dotenv/config';
import { version } from '../package.json';
import { writeSkyConfigToFiles } from './connect/writeSkyConfigToFiles';
import { writeToFiles } from './typegen/writeToFiles';
import { allSettled } from './utils';

const program = new Command();
program.version(version);

program
  .command('typegen')
  .description('Generate TypeScript types from XState machines')
  .argument('<files>', 'The files to target, expressed as a glob pattern')
  .option('-w, --watch', 'Run the typegen in watch mode')
  .action(async (filesPattern: string, opts: { watch?: boolean }) => {
    const cwd = process.cwd();
    if (opts.watch) {
      // TODO: implement per path queuing to avoid tasks related to the same file from overlapping their execution
      const processFile = (path: string) => {
        if (path.endsWith('.typegen.ts')) {
          return;
        }
        writeToFiles([path], { cwd }).catch(() => {});
      };
      // TODO: handle removals
      watch(filesPattern, { awaitWriteFinish: true })
        .on('add', processFile)
        .on('change', processFile);
    } else {
      const tasks: Array<Promise<void>> = [];
      // TODO: could this cleanup outdated typegen files?
      watch(filesPattern, { persistent: false })
        .on('add', (path) => {
          if (path.endsWith('.typegen.ts')) {
            return;
          }
          tasks.push(writeToFiles([path], { cwd }));
        })
        .on('ready', async () => {
          const settled = await allSettled(tasks);
          if (settled.some((result) => result.status === 'rejected')) {
            process.exit(1);
          }
          process.exit(0);
        });
    }
  });

program
  .command('connect')
  .description(
    'Get your machine configs from the Stately Studio, and write them to local files',
  )
  .argument('<files>', 'The files to target, expressed as a glob pattern')
  .option('-w, --watch', 'Run connect in watch mode')
  .option(
    '-k, --api-key <key>',
    'API key to use for interacting with the Stately Studio',
  )
  .option('-h, --host <host>', 'URL pointing to the Stately Studio host')
  .action(
    async (
      filesPattern: string,
      opts: { watch?: boolean; apiKey?: string; host?: string },
    ) => {
      const envApiKey = process.env.STATELY_API_KEY;
      const apiKey = opts.apiKey ?? envApiKey;

      if (opts.watch) {
        const processFile = (uri: string) => {
          writeSkyConfigToFiles({ uri, apiKey, writeToFiles }).catch((e) => {
            console.error(e);
          });
        };
        watch(filesPattern, { awaitWriteFinish: true })
          .on('add', processFile)
          .on('change', processFile);
      } else {
        const tasks: Array<Promise<void>> = [];
        watch(filesPattern, { persistent: false })
          .on('add', (uri) => {
            tasks.push(writeSkyConfigToFiles({ uri, apiKey, writeToFiles }));
          })
          .on('ready', async () => {
            const settled = await allSettled(tasks);
            if (settled.some((result) => result.status === 'rejected')) {
              process.exit(1);
            }
            process.exit(0);
          });
      }
    },
  );

program.parse(process.argv);
