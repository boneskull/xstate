import { assign, createMachine } from 'xstate';
import { createTestModel } from '../src';
import { coversAllStates } from '../src/coverage';
import { createTestMachine } from '../src/machine';
import { getDescription } from '../src/utils';

describe('events', () => {
  it('should allow for representing many cases', async () => {
    type Events =
      | { type: 'CLICK_BAD' }
      | { type: 'CLICK_GOOD' }
      | { type: 'CLOSE' }
      | { type: 'ESC' }
      | { type: 'SUBMIT'; value: string };
    const feedbackMachine = createTestMachine({
      id: 'feedback',
      schema: {
        events: {} as Events
      },
      initial: 'question',
      states: {
        question: {
          on: {
            CLICK_GOOD: 'thanks',
            CLICK_BAD: 'form',
            CLOSE: 'closed',
            ESC: 'closed'
          }
        },
        form: {
          on: {
            SUBMIT: [
              {
                target: 'thanks',
                cond: (_, e) => !!e.value.length
              },
              {
                target: '.invalid'
              }
            ],
            CLOSE: 'closed',
            ESC: 'closed'
          },
          initial: 'valid',
          states: {
            valid: {},
            invalid: {}
          }
        },
        thanks: {
          on: {
            CLOSE: 'closed',
            ESC: 'closed'
          }
        },
        closed: {
          type: 'final'
        }
      }
    });

    const testModel = createTestModel(feedbackMachine, {
      events: {
        SUBMIT: { cases: [{ value: 'something' }, { value: '' }] }
      }
    });

    const testPlans = testModel.getShortestPlans();

    for (const plan of testPlans) {
      await testModel.testPlan(plan);
    }

    expect(() => testModel.testCoverage(coversAllStates())).not.toThrow();
  });

  it('should not throw an error for unimplemented events', () => {
    const testMachine = createTestMachine({
      initial: 'idle',
      states: {
        idle: {
          on: { ACTIVATE: 'active' }
        },
        active: {}
      }
    });

    const testModel = createTestModel(testMachine);

    const testPlans = testModel.getShortestPlans();

    expect(async () => {
      for (const plan of Object.values(testPlans)) {
        await testModel.testPlan(plan);
      }
    }).not.toThrow();
  });

  it('should allow for dynamic generation of cases based on state', async () => {
    const testMachine = createMachine<
      { values: number[] },
      { type: 'EVENT'; value: number }
    >({
      initial: 'a',
      context: {
        values: [1, 2, 3] // to be read by generator
      },
      states: {
        a: {
          on: {
            EVENT: [
              { cond: (_, e) => e.value === 1, target: 'b' },
              { cond: (_, e) => e.value === 2, target: 'c' },
              { cond: (_, e) => e.value === 3, target: 'd' }
            ]
          }
        },
        b: {},
        c: {},
        d: {}
      }
    });

    const testedEvents: any[] = [];

    const testModel = createTestModel(testMachine, {
      events: {
        EVENT: {
          // Read dynamically from state context
          cases: (state) => state.context.values.map((value) => ({ value })),
          exec: ({ event }) => {
            testedEvents.push(event);
          }
        }
      }
    });

    const plans = testModel.getShortestPlans();

    expect(plans.length).toBe(4);

    await testModel.testPlans({ plans });

    expect(testedEvents).toMatchInlineSnapshot(`
      Array [
        Object {
          "type": "EVENT",
          "value": 1,
        },
        Object {
          "type": "EVENT",
          "value": 2,
        },
        Object {
          "type": "EVENT",
          "value": 3,
        },
      ]
    `);
  });
});

describe('state limiting', () => {
  it('should limit states with filter option', () => {
    const machine = createMachine<{ count: number }>({
      initial: 'counting',
      context: { count: 0 },
      states: {
        counting: {
          on: {
            INC: {
              actions: assign({
                count: (ctx) => ctx.count + 1
              })
            }
          }
        }
      }
    });

    const testModel = createTestModel(machine);

    const testPlans = testModel.getShortestPlans({
      filter: (state) => {
        return state.context.count < 5;
      }
    });

    expect(testPlans).toHaveLength(5);
  });
});

describe('plan description', () => {
  const machine = createTestMachine({
    id: 'test',
    initial: 'atomic',
    context: { count: 0 },
    states: {
      atomic: {
        on: { NEXT: 'compound', DONE: 'final' }
      },
      final: {
        type: 'final'
      },
      compound: {
        initial: 'child',
        states: {
          child: {
            on: {
              NEXT: 'childWithMeta'
            }
          },
          childWithMeta: {
            meta: {
              description: 'child with meta'
            }
          }
        },
        on: {
          NEXT: 'parallel'
        }
      },
      parallel: {
        type: 'parallel',
        states: {
          one: {},
          two: {
            meta: {
              description: 'two description'
            }
          }
        },
        on: {
          NEXT: 'noMetaDescription'
        }
      },
      noMetaDescription: {
        meta: {}
      }
    }
  });

  const testModel = createTestModel(machine);
  const testPlans = testModel.getShortestPlans();

  it('should give a description for every plan', () => {
    const planDescriptions = testPlans.map(
      (plan) => `reaches ${getDescription(plan.state)}`
    );

    expect(planDescriptions).toMatchInlineSnapshot(`
      Array [
        "reaches state: \\"#test.atomic\\" ({\\"count\\":0})",
        "reaches state: \\"#test.compound.child\\" ({\\"count\\":0})",
        "reaches state: \\"#test.final\\" ({\\"count\\":0})",
        "reaches state: \\"child with meta\\" ({\\"count\\":0})",
        "reaches states: \\"#test.parallel.one\\", \\"two description\\" ({\\"count\\":0})",
        "reaches state: \\"noMetaDescription\\" ({\\"count\\":0})",
      ]
    `);
  });
});

// https://github.com/statelyai/xstate/issues/1935
it('prevents infinite recursion based on a provided limit', () => {
  const machine = createMachine<{ count: number }>({
    id: 'machine',
    context: {
      count: 0
    },
    on: {
      TOGGLE: {
        actions: assign({ count: (ctx) => ctx.count + 1 })
      }
    }
  });

  const model = createTestModel(machine);

  expect(() => {
    model.getShortestPlans({ traversalLimit: 100 });
  }).toThrowErrorMatchingInlineSnapshot(`"Traversal limit exceeded"`);
});

// TODO: have this as an opt-in
it('executes actions', async () => {
  let executedActive = false;
  let executedDone = false;
  const machine = createTestMachine({
    initial: 'idle',
    states: {
      idle: {
        on: {
          TOGGLE: { target: 'active', actions: 'boom' }
        }
      },
      active: {
        entry: () => {
          executedActive = true;
        },
        on: { TOGGLE: 'done' }
      },
      done: {
        entry: () => {
          executedDone = true;
        }
      }
    }
  });

  const model = createTestModel(machine);

  const testPlans = model.getShortestPlans();

  for (const plan of testPlans) {
    await model.testPlan(plan);
  }

  expect(executedActive).toBe(true);
  expect(executedDone).toBe(true);
});

describe('test model options', () => {
  it('options.testState(...) should test state', async () => {
    const testedStates: any[] = [];

    const model = createTestModel(
      createTestMachine({
        initial: 'inactive',
        states: {
          inactive: {
            on: {
              NEXT: 'active'
            }
          },
          active: {}
        }
      }),
      {
        states: {
          '*': (state) => {
            testedStates.push(state.value);
          }
        }
      }
    );

    const plans = model.getShortestPlans();

    for (const plan of plans) {
      await model.testPlan(plan);
    }

    expect(testedStates).toEqual(['inactive', 'inactive', 'active']);
  });

  it('options.testTransition(...) should test transition', async () => {
    const testedEvents: any[] = [];

    const model = createTestModel(
      createTestMachine({
        initial: 'inactive',
        states: {
          inactive: {
            on: {
              NEXT: 'active'
            }
          },
          active: {
            on: {
              PREV: 'inactive'
            }
          }
        }
      }),
      {
        // Force traversal to consider all transitions
        serializeState: (state) =>
          ((state.value as any) + state.event.type) as any,
        testTransition: (step) => {
          testedEvents.push(step.event.type);
        }
      }
    );

    const plans = model.getShortestPlans();

    for (const plan of plans) {
      await model.testPlan(plan);
    }

    expect(testedEvents).toEqual(['NEXT', 'NEXT', 'PREV']);
  });
});

// https://github.com/statelyai/xstate/issues/1538
it('tests transitions', async () => {
  expect.assertions(2);
  const machine = createTestMachine({
    initial: 'first',
    states: {
      first: {
        on: { NEXT: 'second' }
      },
      second: {}
    }
  });

  const model = createTestModel(machine, {
    events: {
      NEXT: {
        exec: (step) => {
          expect(step).toHaveProperty('event');
          expect(step).toHaveProperty('state');
        }
      }
    }
  });

  const plans = model.getShortestPlansTo((state) => state.matches('second'));

  const path = plans[0].paths[0];

  await model.testPath(path);
});

// https://github.com/statelyai/xstate/issues/982
it('Event in event executor should contain payload from case', async () => {
  const machine = createTestMachine({
    initial: 'first',
    states: {
      first: {
        on: { NEXT: 'second' }
      },
      second: {}
    }
  });

  const obj = {};

  const nonSerializableData = () => 42;

  const model = createTestModel(machine, {
    events: {
      NEXT: {
        cases: [{ payload: 10, fn: nonSerializableData }],
        exec: (step) => {
          expect(step.event).toEqual({
            type: 'NEXT',
            payload: 10,
            fn: nonSerializableData
          });
        }
      }
    }
  });

  const plans = model.getShortestPlansTo((state) => state.matches('second'));

  const path = plans[0].paths[0];

  await model.testPath(path, obj);
});

describe('state tests', () => {
  it('should test states', async () => {
    // a (1)
    // a -> b (2)
    expect.assertions(3);

    const machine = createTestMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {}
      }
    });

    const model = createTestModel(machine, {
      states: {
        a: (state) => {
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          expect(state.value).toEqual('b');
        }
      }
    });

    await model.testPlans();
  });

  it('should test wildcard state for non-matching states', async () => {
    // a (1)
    // a -> b (2)
    // a -> c (2)
    expect.assertions(5);

    const machine = createTestMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b', OTHER: 'c' }
        },
        b: {},
        c: {}
      }
    });

    const model = createTestModel(machine, {
      states: {
        a: (state) => {
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          expect(state.value).toEqual('b');
        },
        '*': (state) => {
          expect(state.value).toEqual('c');
        }
      }
    });

    await model.testPlans();
  });

  it('should test nested states', async () => {
    const testedStateValues: any[] = [];

    const machine = createTestMachine({
      initial: 'a',
      states: {
        a: {
          on: { NEXT: 'b' }
        },
        b: {
          initial: 'b1',
          states: {
            b1: {}
          }
        }
      }
    });

    const model = createTestModel(machine, {
      states: {
        a: (state) => {
          testedStateValues.push('a');
          expect(state.value).toEqual('a');
        },
        b: (state) => {
          testedStateValues.push('b');
          expect(state.matches('b')).toBe(true);
        },
        'b.b1': (state) => {
          testedStateValues.push('b.b1');
          expect(state.value).toEqual({ b: 'b1' });
        }
      }
    });

    await model.testPlans();
    expect(testedStateValues).toMatchInlineSnapshot(`
      Array [
        "a",
        "a",
        "b",
        "b.b1",
      ]
    `);
  });
});
