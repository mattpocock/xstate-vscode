import outdent from 'outdent';
import { parseMachinesFromFile } from '../../parseMachinesFromFile';

const getModifiableMachine = (code: string) =>
  parseMachinesFromFile(outdent.string(code)).machines[0];

describe('add_action', () => {
  it('should be possible to add an entry action to the root', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({})
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['entry', 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        entry: "doStuff"
      })"
    `);
  });

  it('should be possible to add an entry action to a nested state', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        initial: 'a',
        states: {
          a: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: ['a'],
          actionPath: ['entry', 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        initial: 'a',
        states: {
          a: {
            entry: "doStuff"
          }
        }
      })"
    `);
  });

  it('should be possible to add an exit action to the root', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({})
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['exit', 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        exit: "doStuff"
      })"
    `);
  });

  it('should be possible to add an exit action to a nested state', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        initial: 'a',
        states: {
          a: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: ['a'],
          actionPath: ['exit', 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        initial: 'a',
        states: {
          a: {
            exit: "doStuff"
          }
        }
      })"
    `);
  });

  it('should be possible to add an entry action to an existing single entry action', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        entry: 'bark',
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['entry', 1],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        entry: ['bark', "doStuff"],
      })"
    `);
  });

  it('should be possible to add an exit action to an existing single exit action', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        exit: 'bark',
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['exit', 1],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        exit: ['bark', "doStuff"],
      })"
    `);
  });

  it('should be possible to add an entry action at the start of the existing entry actions', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        entry: ['bark', 'meow'],
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['entry', 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        entry: ["doStuff", 'bark', 'meow'],
      })"
    `);
  });

  it('should be possible to add an entry action at the end of the existing entry actions', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        entry: ['bark', 'meow'],
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['entry', 2],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        entry: ['bark', 'meow', "doStuff"],
      })"
    `);
  });

  it('should be possible to add an entry action in the middle of existing entry actions', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        entry: ['bark', 'meow'],
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['entry', 1],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        entry: ['bark', "doStuff", 'meow'],
      })"
    `);
  });

  it('should be possible to add a transition action to the root', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        on: {
          FOO: '.a',
        },
        states: {
          a: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['on', 'FOO', 0, 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        on: {
          FOO: {
            target: '.a',
            actions: "doStuff"
          },
        },
        states: {
          a: {}
        }
      })"
    `);
  });

  it(`should be possible to add a transition action to invoke's onDone`, () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        states: {
          a: {
            invoke: {
              src: 'callDavid',
              onDone: 'b'
            }
          },
          b: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: ['a'],
          actionPath: ['invoke', 0, 'onDone', 0, 0],
          name: 'getRaise',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        states: {
          a: {
            invoke: {
              src: 'callDavid',
              onDone: {
                target: 'b',
                actions: "getRaise"
              }
            }
          },
          b: {}
        }
      })"
    `);
  });

  it('should be possible to add a transition action to an object transition', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        on: {
          FOO: {
            target: '.a',
            description: 'beautiful arrow, wow'
          },
        },
        states: {
          a: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['on', 'FOO', 0, 0],
          name: 'doStuff',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        on: {
          FOO: {
            target: '.a',
            description: 'beautiful arrow, wow',
            actions: "doStuff"
          },
        },
        states: {
          a: {}
        }
      })"
    `);
  });

  it('should be possible to add a transition action to an existing transition action', () => {
    const modifiableMachine = getModifiableMachine(`
      createMachine({
        on: {
          FOO: {
            target: '.a',
            actions: 'callDavid'
          },
        },
        states: {
          a: {}
        }
      })
  `);

    expect(
      modifiableMachine.modify([
        {
          type: 'add_action',
          path: [],
          actionPath: ['on', 'FOO', 0, 1],
          name: 'getRaise',
        },
      ]).newText,
    ).toMatchInlineSnapshot(`
      "createMachine({
        on: {
          FOO: {
            target: '.a',
            actions: ['callDavid', "getRaise"]
          },
        },
        states: {
          a: {}
        }
      })"
    `);
  });
});
