import { enablePatches, type Patch } from 'immer';
import type {
  CallExpression,
  Program,
  PropertyAssignment,
  SourceFile,
} from 'typescript';
import { c, createCodeChanges, InsertionPriority } from './codeChanges';
import { extractState } from './state';
import type {
  DeleteTextEdit,
  ExtractionContext,
  ExtractionError,
  ExtractorDigraphDef,
  InsertTextEdit,
  LineAndCharacterPosition,
  LinesAndCharactersRange,
  ProjectMachineState,
  Range,
  ReplaceTextEdit,
  TextEdit,
  TreeNode,
  XStateVersion,
} from './types';
import { assert, findNodeByAstPath, findProperty } from './utils';

enablePatches();

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

function resolvePathOrigin(
  ctx: ExtractionContext,
  sourceId: string,
  origin: string | undefined,
): TreeNode | undefined {
  if (origin === undefined) {
    return;
  }
  if (origin === '') {
    return ctx.treeNodes[sourceId];
  }
  if (origin[0] === '#') {
    const originId = ctx.idMap[origin.slice(1)];
    return ctx.treeNodes[originId];
  }

  const source = ctx.treeNodes[sourceId];
  if (!source.parentId) {
    return;
  }
  const parent = ctx.treeNodes[source.parentId];
  return parent.children[origin];
}

function resolveTargetId(
  ctx: ExtractionContext,
  sourceId: string,
  target: string,
) {
  // TODO: handle escaping once we land it in XState
  const [origin, ...path] = target.split('.');
  const resolvedOrigin = resolvePathOrigin(ctx, sourceId, origin);
  if (!resolvedOrigin) {
    ctx.errors.push({
      type: 'transition_target_unresolved',
    });
    return;
  }

  let marker = resolvedOrigin;
  let segment: string | undefined;
  while ((segment = path.shift())) {
    marker = marker.children[segment];
    if (!marker) {
      ctx.errors.push({
        type: 'transition_target_unresolved',
      });
      return;
    }
  }
  return marker.uniqueId;
}

function resolveTargets(ctx: ExtractionContext) {
  for (const [edgeId, edgeTargets] of Object.entries(ctx.originalTargets)) {
    for (const edgeTarget of edgeTargets) {
      const sourceId = ctx.digraph.edges[edgeId].source;
      const resolvedTargetId = resolveTargetId(ctx, sourceId, edgeTarget);
      if (!resolvedTargetId) {
        ctx.errors.push({
          type: 'transition_property_unhandled',
        });
        continue;
      }
      ctx.digraph.edges[edgeId].targets.push(resolvedTargetId);
    }
  }
}

function extractMachineConfig(
  ctx: ExtractionContext,
  ts: typeof import('typescript'),
  createMachineCall: CallExpression,
): readonly [ExtractorDigraphDef | undefined, ExtractionError[]] {
  const rootState = createMachineCall.arguments[0];
  const rootNode = extractState(ctx, ts, rootState, {
    parentId: undefined,
    key: '(machine)', // acts as a default that might be overriden by `rootState.id`
  });

  if (!rootNode) {
    return [undefined, ctx.errors];
  }

  resolveTargets(ctx);

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

export interface TSProjectOptions {
  xstateVersion?: XStateVersion | undefined;
}

function extractProjectMachine(
  host: ProjectHost,
  sourceFile: SourceFile,
  call: CallExpression,
  oldState: ProjectMachineState | undefined,
) {
  const ctx: ExtractionContext = {
    sourceFile,
    xstateVersion: host.xstateVersion,
    oldState,
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
    treeNodes: {},
    idMap: {},
    originalTargets: {},
    currentAstPath: [],
    astPaths: {
      nodes: {},
      edges: {},
    },
  };
  const [digraph, errors] = extractMachineConfig(ctx, host.ts, call);
  return {
    digraph,
    errors,
    astPaths: ctx.astPaths,
  };
}

function createProjectMachine({
  host,
  fileName,
  machineIndex,
}: {
  host: ProjectHost;
  fileName: string;
  machineIndex: number;
}) {
  let state: ProjectMachineState | undefined;

  const findOwnCreateMachineCall = () => {
    const sourceFile = host.getCurrentProgram().getSourceFile(fileName);

    if (!sourceFile) {
      throw new Error('File not found');
    }

    const createMachineCall = findCreateMachineCalls(host.ts, sourceFile)[
      machineIndex
    ];

    if (!createMachineCall) {
      throw new Error('Machine not found');
    }
    return { sourceFile, createMachineCall };
  };

  return {
    fileName,
    machineIndex,
    getDigraph() {
      const { sourceFile, createMachineCall } = findOwnCreateMachineCall();
      state = extractProjectMachine(host, sourceFile, createMachineCall, state);
      return [state.digraph, state.errors] as const;
    },
    applyPatches(patches: readonly Patch[]): TextEdit[] {
      const codeChanges = createCodeChanges(host.ts);
      const { sourceFile, createMachineCall } = findOwnCreateMachineCall();
      const currentState = state!;

      // TODO: enable this, currently it throws - presumably because the patch might contain data that are not part of this local `digraph`
      // currentState.digraph = applyPatches(
      //   currentState.digraph!,
      //   patches,
      // ) as any;

      for (const patch of patches) {
        switch (patch.op) {
          case 'add':
            switch (patch.path[0]) {
              case 'nodes': {
                // we only support adding empty states here right now
                // this might become a problem, especially when dealing with copy-pasting
                // the implementation will have to account for that in the future
                const newNode = patch.value;
                const parentNode = findNodeByAstPath(
                  host.ts,
                  createMachineCall,
                  currentState.astPaths.nodes[newNode.parentId],
                );
                assert(host.ts.isObjectLiteralExpression(parentNode));
                const { key } = patch.value.data;

                const statesProp = findProperty(
                  undefined,
                  host.ts,
                  parentNode,
                  'states',
                );

                if (statesProp) {
                  assert(
                    host.ts.isObjectLiteralExpression(statesProp.initializer),
                  );
                  codeChanges.insertPropertyIntoObject(
                    statesProp.initializer,
                    key,
                    c.object([]),
                  );
                  break;
                }

                codeChanges.insertPropertyIntoObject(
                  parentNode,
                  'states',
                  c.object([c.property(key, c.object([]))]),
                  InsertionPriority.States,
                );
              }
            }
            break;
          case 'remove':
            break;
          case 'replace':
            switch (patch.path[0]) {
              case 'nodes':
                const nodeId = patch.path[1];
                if (patch.path[2] === 'data' && patch.path[3] === 'key') {
                  const node = findNodeByAstPath(
                    host.ts,
                    createMachineCall,
                    currentState.astPaths.nodes[nodeId],
                  );
                  const parentNode = findNodeByAstPath(
                    host.ts,
                    createMachineCall,
                    currentState.astPaths.nodes[nodeId].slice(0, -1),
                  );
                  assert(host.ts.isObjectLiteralExpression(parentNode));
                  const prop = parentNode.properties.find(
                    (p): p is PropertyAssignment =>
                      host.ts.isPropertyAssignment(p) && p.initializer === node,
                  )!;
                  codeChanges.replacePropertyName(prop, patch.value);
                  break;
                }
                if (patch.path[2] === 'data' && patch.path[3] === 'initial') {
                  const node = findNodeByAstPath(
                    host.ts,
                    createMachineCall,
                    currentState.astPaths.nodes[nodeId],
                  );
                  assert(host.ts.isObjectLiteralExpression(node));
                  const initialProp = findProperty(
                    undefined,
                    host.ts,
                    node,
                    'initial',
                  );
                  if (patch.value === undefined) {
                    // this check is defensive, it should always be there
                    if (initialProp) {
                      codeChanges.removeProperty(initialProp);
                    }
                    break;
                  }

                  if (initialProp) {
                    codeChanges.replaceRange(sourceFile, {
                      range: {
                        start: initialProp.initializer.getStart(),
                        end: initialProp.initializer.getEnd(),
                      },
                      element: c.string(patch.value),
                    });
                    break;
                  }

                  const statesProp = findProperty(
                    undefined,
                    host.ts,
                    node,
                    'states',
                  );

                  if (statesProp) {
                    codeChanges.insertPropertyBeforeProperty(
                      statesProp,
                      'initial',
                      c.string(patch.value),
                    );
                    break;
                  }

                  codeChanges.insertPropertyIntoObject(
                    node,
                    'initial',
                    c.string(patch.value),
                    InsertionPriority.Initial,
                  );
                }
                if (patch.path[2] === 'data' && patch.path[3] === 'type') {
                  const node = findNodeByAstPath(
                    host.ts,
                    createMachineCall,
                    currentState.astPaths.nodes[nodeId],
                  );
                  assert(host.ts.isObjectLiteralExpression(node));
                  const typeProp = findProperty(
                    undefined,
                    host.ts,
                    node,
                    'type',
                  );
                  if (patch.value === 'normal') {
                    if (typeProp) {
                      codeChanges.removeProperty(typeProp);
                    }
                    break;
                  }

                  if (typeProp) {
                    codeChanges.replaceRange(sourceFile, {
                      range: {
                        start: typeProp.initializer.getStart(),
                        end: typeProp.initializer.getEnd(),
                      },
                      element: c.string(patch.value),
                    });
                    break;
                  }

                  codeChanges.insertPropertyIntoObject(
                    node,
                    'type',
                    c.string(patch.value),
                    InsertionPriority.StateType,
                  );
                }
                if (patch.path[2] === 'data' && patch.path[3] === 'history') {
                  const node = findNodeByAstPath(
                    host.ts,
                    createMachineCall,
                    currentState.astPaths.nodes[nodeId],
                  );
                  assert(host.ts.isObjectLiteralExpression(node));
                  const historyProp = findProperty(
                    undefined,
                    host.ts,
                    node,
                    'history',
                  );
                  if (patch.value === undefined || patch.value === 'shallow') {
                    if (historyProp) {
                      codeChanges.removeProperty(historyProp);
                    }
                    break;
                  }

                  if (historyProp) {
                    codeChanges.replaceRange(sourceFile, {
                      range: {
                        start: historyProp.initializer.getStart(),
                        end: historyProp.initializer.getEnd(),
                      },
                      element: c.string(patch.value),
                    });
                    break;
                  }

                  // TODO: insert it after the existing `type` property
                  codeChanges.insertPropertyIntoObject(
                    node,
                    'history',
                    c.string(patch.value),
                    InsertionPriority.History,
                  );
                }
            }
            break;
        }
      }

      return codeChanges.getTextEdits();
    },
  };
}

type ProjectMachine = ReturnType<typeof createProjectMachine>;

interface ProjectHost {
  ts: typeof import('typescript');
  xstateVersion: XStateVersion;
  getCurrentProgram: () => Program;
}

export function createProject(
  ts: typeof import('typescript'),
  tsProgram: Program,
  { xstateVersion = '5' }: TSProjectOptions = {},
) {
  const projectMachines: Record<string, ProjectMachine[]> = {};

  let currentProgram = tsProgram;

  const host: ProjectHost = {
    ts,
    xstateVersion,
    getCurrentProgram() {
      return currentProgram;
    },
  };

  return {
    findMachines: (fileName: string): Range[] => {
      const sourceFile = currentProgram.getSourceFile(fileName);
      if (!sourceFile) {
        return [];
      }
      return findCreateMachineCalls(ts, sourceFile).map((call) => {
        return {
          start: call.getStart(),
          end: call.getEnd(),
        };
      });
    },
    getMachinesInFile(fileName: string) {
      const existing = projectMachines[fileName];
      if (existing) {
        return existing.map((machine) => machine.getDigraph());
      }
      const sourceFile = currentProgram.getSourceFile(fileName);
      if (!sourceFile) {
        return [];
      }
      const calls = findCreateMachineCalls(ts, sourceFile);
      const created = calls.map((call, machineIndex) =>
        createProjectMachine({ host, fileName, machineIndex }),
      );
      projectMachines[fileName] = created;
      return created.map((machine) => machine.getDigraph());
    },
    applyPatches({
      fileName,
      machineIndex,
      patches,
    }: {
      fileName: string;
      machineIndex: number;
      patches: readonly Patch[];
    }): TextEdit[] {
      const machine = projectMachines[fileName]?.[machineIndex];
      if (!machine) {
        throw new Error('Machine not found');
      }
      return machine.applyPatches(patches);
    },
    updateTsProgram(tsProgram: Program) {
      currentProgram = tsProgram;
    },
    getLineAndCharacterOfPosition(
      fileName: string,
      position: number,
    ): LineAndCharacterPosition {
      const sourceFile = currentProgram.getSourceFile(fileName);
      assert(sourceFile);
      return sourceFile.getLineAndCharacterOfPosition(position);
    },
    getLinesAndCharactersRange(
      fileName: string,
      range: Range,
    ): LinesAndCharactersRange {
      const sourceFile = currentProgram.getSourceFile(fileName);
      assert(sourceFile);
      return {
        start: sourceFile.getLineAndCharacterOfPosition(range.start),
        end: sourceFile.getLineAndCharacterOfPosition(range.end),
      };
    },
  };
}

export type XStateProject = ReturnType<typeof createProject>;

export {
  DeleteTextEdit,
  ExtractorDigraphDef,
  InsertTextEdit,
  LineAndCharacterPosition,
  LinesAndCharactersRange,
  Patch,
  Range,
  ReplaceTextEdit,
  TextEdit,
};
