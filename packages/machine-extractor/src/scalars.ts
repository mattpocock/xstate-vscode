import { types as t } from "@babel/core";
import { createParser } from "./createParser";
import {
  maybeIdentifierTo,
  memberExpressionReferencingEnumMember,
} from "./identifiers";
import { maybeTsAsExpression } from "./tsAsExpression";
import { StringLiteralNode } from "./types";
import { unionType } from "./unionType";
import { wrapParserResult } from "./wrapParserResult";

export const StringLiteral = unionType([
  wrapParserResult(memberExpressionReferencingEnumMember, ({ path, value }) => {
    return {
      path,
      node: path.node as t.Node,
      value: value,
    };
  }),
  maybeTsAsExpression(
    maybeIdentifierTo(
      createParser({
        babelMatcher: t.isStringLiteral,
        parsePath: (path): StringLiteralNode => {
          return {
            value: path.node.value,
            node: path.node,
            path,
          };
        },
      })
    )
  ),
]);

export const NumericLiteral = maybeTsAsExpression(
  maybeIdentifierTo(
    createParser({
      babelMatcher: t.isNumericLiteral,
      parsePath: (path) => {
        return {
          value: path.node.value,
          node: path.node,
          path,
        };
      },
    })
  )
);

export const BooleanLiteral = maybeTsAsExpression(
  maybeIdentifierTo(
    createParser({
      babelMatcher: t.isBooleanLiteral,
      parsePath: (path) => {
        return {
          value: path.node.value,
          node: path.node,
          path,
        };
      },
    })
  )
);

export const AnyNode = createParser({
  babelMatcher: t.isNode,
  parsePath: (path) => ({ path, node: path.node }),
});

export const Identifier = createParser({
  babelMatcher: t.isIdentifier,
  parsePath: (path) => ({ path, node: path.node }),
});

export const TemplateLiteral = maybeTsAsExpression(
  maybeIdentifierTo(
    createParser({
      babelMatcher: t.isTemplateLiteral,
      parsePath: (path) => {
        let value = "";

        // TODO - this might lead to weird issues if there is actually more than a single quasi there
        path.node.quasis.forEach((quasi) => {
          value = `${value}${quasi.value.raw}`;
        });
        return {
          node: path.node,
          path,
          value,
        };
      },
    })
  )
);
