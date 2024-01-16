import type { CallExpression, Program, SourceFile } from 'typescript';
import { extractState } from './state';
import {
  ExtractionContext,
  ExtractionError,
  ExtractorDigraphDef,
} from './types';

function findCreateMachineCalls(
  ts: typeof import('typescript'),
  sourceFile: SourceFile,
) {
  const createMachineCalls: CallExpression[] = [];

  sourceFile.forEachChild(function visitor(node) {
    if (ts.isTypeNode(node)) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        ts.idText(node.expression) === 'createMachine') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.name) &&
          ts.idText(node.expression.name) === 'createMachine'))
    ) {
      createMachineCalls.push(node);
    }
    node.forEachChild(visitor);
  });

  return createMachineCalls;
}

function extractMachineConfig(
  ctx: ExtractionContext,
  ts: typeof import('typescript'),
  createMachineCall: CallExpression,
): readonly [ExtractorDigraphDef | undefined, ExtractionError[]] {
  const rootState = createMachineCall.arguments[0];
  const rootNode = extractState(ctx, ts, rootState, undefined);

  if (!rootNode) {
    return [undefined, ctx.errors];
  }

  return [
    {
      root: rootNode.uniqueId,
      blocks: ctx.digraph.blocks,
      nodes: ctx.digraph.nodes,
      edges: ctx.digraph.edges,
      implementations: ctx.digraph.implementations,
      data: ctx.digraph.data,
    },
    ctx.errors,
  ];
}

export function createProject(
  ts: typeof import('typescript'),
  tsProgram: Program,
) {
  return {
    extractMachines(fileName: string) {
      const sourceFile = tsProgram.getSourceFile(fileName);
      if (!sourceFile) {
        return [];
      }
      return findCreateMachineCalls(ts, sourceFile).map((call) => {
        const ctx: ExtractionContext = {
          sourceFile,
          errors: [],
          digraph: {
            nodes: {},
            edges: {},
            blocks: {},
            implementations: {
              actions: {},
              actors: {},
              guards: {},
            },
            data: {
              context: {},
            },
          },
        };
        return extractMachineConfig(ctx, ts, call);
      });
    },
  };
}

export type XStateProject = ReturnType<typeof createProject>;
