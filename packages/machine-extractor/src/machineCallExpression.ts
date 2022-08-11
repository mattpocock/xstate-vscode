import { types as t } from "@babel/core";
import { createParser } from "./createParser";
import { MachineOptions } from "./options";
import { StateNode } from "./stateNode";
import { AnyTypeParameterList } from "./typeParameters";
import { GetParserResult } from "./utils";

export type TMachineCallExpression = GetParserResult<
  typeof MachineCallExpression
>;

export const ALLOWED_CALL_EXPRESSION_NAMES = [
  "createMachine",
  "Machine",
  "createTestMachine",
];

export const MachineCallExpression = createParser({
  babelMatcher: t.isCallExpression,
  parsePath: (path, context) => {
    const node = path.node;
    if (
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.property) &&
      ALLOWED_CALL_EXPRESSION_NAMES.includes(node.callee.property.name)
    ) {
      return {
        callee: node.callee,
        calleeName: node.callee.property.name,
        definition: StateNode.parse(path.get("arguments")[0], context),
        options: MachineOptions.parse(path.get("arguments")[1], context),
        isMemberExpression: true,
        typeArguments: AnyTypeParameterList.parse(
          path.get("typeParameters"),
          context
        ),
        node,
        path,
      };
    }

    if (
      t.isIdentifier(node.callee) &&
      ALLOWED_CALL_EXPRESSION_NAMES.includes(node.callee.name)
    ) {
      return {
        callee: node.callee,
        calleeName: node.callee.name,
        definition: StateNode.parse(path.get("arguments")[0], context),
        options: MachineOptions.parse(path.get("arguments")[1], context),
        isMemberExpression: false,
        typeArguments: AnyTypeParameterList.parse(
          path.get("typeParameters"),
          context
        ),
        node,
        path,
      };
    }
  },
});
