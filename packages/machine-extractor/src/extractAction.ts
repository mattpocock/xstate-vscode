import * as t from '@babel/types';
import { ActionNode } from './actions';
import { JsonExpressionString, JsonItem } from './types';
import { toJsonExpressionString } from './utils';

type ObjectProperyWithIdentifierKey = t.ObjectProperty & {
  key: t.Identifier;
};

export function extractAssignAction(
  actionNode: ActionNode,
  fileContent: string,
): Record<string, JsonItem | JsonExpressionString> | JsonExpressionString {
  const node = actionNode.node;
  if (t.isCallExpression(node)) {
    const assigner = node.arguments[0];

    // assign({})
    if (
      t.isObjectExpression(assigner) &&
      assigner.properties.every((prop) => t.isObjectProperty(prop))
    ) {
      const assignment: Record<string, JsonItem> = {};

      assigner.properties.forEach((prop) => {
        // any regular object property and no spread elements or method or such
        if (t.isObjectProperty(prop)) {
          if (t.isIdentifier(prop.key)) {
            if (
              /**
               * assign({prop: []})
               * assign({prop: {}})
               */
              t.isArrayExpression(prop.value) ||
              t.isObjectExpression(prop.value)
            ) {
              assignment[prop.key.name] = toJsonExpressionString(
                fileContent.slice(prop.value.start!, prop.value.end!),
              );
            } else if (t.isLiteral(prop.value)) {
              /**
               * assign({prop: literal value})
               */
              if (
                t.isRegExpLiteral(prop.value) ||
                isTemplateLiteralWithExpressions(prop.value) ||
                t.isNullLiteral(prop.value)
              ) {
                assignment[prop.key.name] = toJsonExpressionString(
                  fileContent.slice(prop.value.start!, prop.value.end!),
                );
              } else if (t.isTemplateLiteral(prop.value)) {
                assignment[prop.key.name] =
                  prop.value.quasis[0].value.cooked ??
                  prop.value.quasis[0].value.raw;
              } else {
                assignment[prop.key.name] = prop.value.value;
              }
            } else {
              /**
               * assign({prop: () => {}})
               * assign({prop: function() {}})
               * or anything else
               */
              assignment[prop.key.name] = toJsonExpressionString(
                fileContent.slice(prop.value.start!, prop.value.end!),
              );
            }
          }
        }
      });

      return assignment;
    }

    // assign(() => {})
    // assign(function() {})
    // assign({...someVar})
    // assign(someVar)
    // or anything else
    return toJsonExpressionString(
      fileContent.slice(assigner.start!, assigner.end!),
    );
  }

  throw Error(`Unsupported assign action`);
}

export function extractRaiseAction(
  actionNode: ActionNode,
  fileContent: string,
): Record<string, JsonItem> | JsonExpressionString {
  const node = actionNode.node;
  if (t.isCallExpression(node)) {
    const arg = node.arguments[0];

    // raise({type: 'event'}) object with plain object properties
    if (
      t.isObjectExpression(arg) &&
      arg.properties.every((prop) => t.isObjectProperty(prop))
    ) {
      return extractEventObject(arg, fileContent);
    }

    // raise('event')
    if (t.isStringLiteral(arg)) {
      return {
        type: arg.value,
      };
    }

    // raise(() => {}) or anything else
    return toJsonExpressionString(fileContent.slice(arg.start!, arg.end!));
  }

  throw Error(`Unsupported raise action`);
}

export function extractLogAction(
  actionNode: ActionNode,
  fileContent: string,
): string | JsonExpressionString {
  const node = actionNode.node;
  if (t.isCallExpression(node)) {
    const arg = node.arguments[0];

    // log('string')
    if (t.isStringLiteral(arg)) {
      return arg.value;
    }

    // log((ctx, evt) => {}) or anything else
    return toJsonExpressionString(fileContent.slice(node.start!, node.end!));
  }

  throw Error(`Unsupported log action`);
}

export function extractStopAction(
  actionNode: ActionNode,
  fileContent: string,
): string | JsonExpressionString {
  const node = actionNode.node;
  if (t.isCallExpression(node)) {
    const arg = node.arguments[0];

    // stop('id')
    if (t.isStringLiteral(arg)) {
      return arg.value;
    }

    // stop(() => {}) or anything else
    return toJsonExpressionString(fileContent.slice(arg.start!, arg.end!));
  }

  throw Error('Unsupported stop action');
}

type SendToEventArg = JsonExpressionString | Record<string, JsonItem>;
type SendToActorRefArg = string | JsonExpressionString;
type SendToIdArg = string | JsonExpressionString;
type SendToDelayArg = string | number | JsonExpressionString;

export function extractSendToAction(
  actionNode: ActionNode,
  fileContent: string,
): {
  event: SendToEventArg;
  to: SendToActorRefArg;
  delay: SendToDelayArg;
  id: SendToIdArg;
} {
  const node = actionNode.node;
  let eventObject: SendToEventArg = {};
  let actorRef: SendToActorRefArg = '';
  const options: { id: SendToIdArg; delay: SendToDelayArg } = {
    id: '',
    delay: 0,
  };
  if (t.isCallExpression(node)) {
    const arg1 = node.arguments[0];
    const arg2 = node.arguments[1];
    const arg3 = node.arguments[2];

    // Actor
    // sendTo('actorName')
    if (t.isStringLiteral(arg1)) {
      actorRef = arg1.value;
    }
    // sendTo((ctx, e) => actorRef) or anything else
    else {
      actorRef = toJsonExpressionString(
        fileContent.slice(arg1.start!, arg1.end!),
      );
    }

    // Event
    // sendTo(, 'eventType')
    if (t.isStringLiteral(arg2)) {
      eventObject = {
        type: arg2.value,
      };
    }

    // sendTo(, {type: 'event', id: 1}),
    else if (t.isObjectExpression(arg2)) {
      eventObject = extractEventObject(arg2, fileContent);
    }

    // sendTo(, (ctx, e) => Record<string, any>) or anything else
    else {
      eventObject = toJsonExpressionString(
        fileContent.slice(arg2.start!, arg2.end!),
      );
    }

    // Options
    if (t.isObjectExpression(arg3)) {
      arg3.properties
        .filter(
          (prop): prop is ObjectProperyWithIdentifierKey =>
            t.isObjectProperty(prop) && t.isIdentifier(prop.key),
        )
        .forEach((prop) => {
          const name = prop.key.name;
          if (t.isStringLiteral(prop.value) || t.isBigIntLiteral(prop.value)) {
            options[name as 'id' | 'delay'] = prop.value.value;
          } else if (t.isNumericLiteral(prop.value)) {
            options[name as 'delay'] = prop.value.value;
          }
          // () => {} or anything else
          else {
            options[name as 'id' | 'delay'] = toJsonExpressionString(
              fileContent.slice(prop.value.start!, prop.value.end!),
            );
          }
        });
    }

    // Todo: what to do with invalid actions? like the one that misses the actor or event?
    // @ts-ignore
    // Todo: Help me type this so options includes delay and id but could also include anything else
    return {
      event: eventObject,
      to: actorRef,
      ...options,
    };
  }

  throw Error(`Unsupported sendTo action`);
}

// Todo: support namespace imports and aliased specifiers
// import * as actions from 'xstate'; actions.sendTo
// import {sendTo as x} from 'xstate'
export const getActionCreatorName = (actionNode: ActionNode) =>
  t.isCallExpression(actionNode.node) && t.isIdentifier(actionNode.node.callee)
    ? actionNode.node.callee.name
    : undefined;

// TODO: enforce return type to ActionEvent so `type` property is required
function extractEventObject(
  eventObject: t.ObjectExpression,
  fileContent: string,
): JsonExpressionString | Record<string, JsonItem> {
  if (!eventObject.properties.every((prop) => t.isObjectProperty(prop))) {
    return toJsonExpressionString(
      fileContent.slice(eventObject.start!, eventObject.end!),
    );
  }

  const extracted: Record<string, JsonItem> = {};
  eventObject.properties.forEach((prop) => {
    if (t.isObjectProperty(prop)) {
      if (t.isIdentifier(prop.key)) {
        if (t.isLiteral(prop.value)) {
          if (
            t.isRegExpLiteral(prop.value) ||
            isTemplateLiteralWithExpressions(prop.value) ||
            t.isNullLiteral(prop.value)
          ) {
            extracted[prop.key.name] = toJsonExpressionString(
              fileContent.slice(prop.value.start!, prop.value.end!),
            );
          } else if (t.isTemplateLiteral(prop.value)) {
            extracted[prop.key.name] =
              prop.value.quasis[0].value.cooked ??
              prop.value.quasis[0].value.raw;
          } else {
            extracted[prop.key.name] = prop.value.value;
          }
        } else if (
          t.isArrayExpression(prop.value) ||
          t.isObjectExpression(prop.value)
        ) {
          extracted[prop.key.name] = toJsonExpressionString(
            fileContent.slice(prop.value.start!, prop.value.end!),
          );
        } else {
          console.warn(
            `Unsupported property value of type ${prop.value.type} in assignment`,
            { key: prop.key.name, value: prop.value },
          );
        }
      }
    }
  });

  return extracted;
}

function isTemplateLiteralWithExpressions(node: t.Literal): boolean {
  return t.isTemplateLiteral(node) && node.expressions.length > 0;
}
