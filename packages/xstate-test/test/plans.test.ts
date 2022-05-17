import { createTestModel } from '../src';
import { coversAllStates } from '../src/coverage';
import { createTestMachine } from '../src/machine';

const multiPathMachine = createTestMachine({
  initial: 'a',
  states: {
    a: {
      on: {
        EVENT: 'b'
      }
    },
    b: {
      on: {
        EVENT: 'c'
      }
    },
    c: {
      on: {
        EVENT: 'd',
        EVENT_2: 'e'
      }
    },
    d: {},
    e: {}
  }
});

describe('testModel.testPlans(...)', () => {
  it('custom plan generators can be provided', async () => {
    const testModel = createTestModel(
      createTestMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {}
        }
      })
    );

    const plans = testModel.getPlans({
      planGenerator: (behavior, options) => {
        const events = options.getEvents?.(behavior.initialState) ?? [];

        const nextState = behavior.transition(behavior.initialState, events[0]);
        return [
          {
            state: nextState,
            paths: [
              {
                state: nextState,
                steps: [
                  {
                    state: behavior.initialState,
                    event: events[0]
                  }
                ],
                weight: 1
              }
            ]
          }
        ];
      }
    });

    await testModel.testPlans(plans);

    expect(testModel.getCoverage(coversAllStates())).toMatchInlineSnapshot(`
      Array [
        Object {
          "criterion": Object {
            "description": "Visits \\"(machine)\\"",
            "predicate": [Function],
            "skip": false,
          },
          "status": "covered",
        },
        Object {
          "criterion": Object {
            "description": "Visits \\"(machine).a\\"",
            "predicate": [Function],
            "skip": false,
          },
          "status": "covered",
        },
        Object {
          "criterion": Object {
            "description": "Visits \\"(machine).b\\"",
            "predicate": [Function],
            "skip": false,
          },
          "status": "covered",
        },
      ]
    `);
  });

  describe('When the machine only has one path', () => {
    it('Should only follow that path', () => {
      const machine = createTestMachine({
        initial: 'a',
        states: {
          a: {
            on: {
              EVENT: 'b'
            }
          },
          b: {
            on: {
              EVENT: 'c'
            }
          },
          c: {}
        }
      });

      const model = createTestModel(machine);

      const plans = model.getPlans();

      expect(plans).toHaveLength(1);
    });
  });

  describe('When the machine only has more than one path', () => {
    it('Should create plans for each path', () => {
      const model = createTestModel(multiPathMachine);

      const plans = model.getPlans();

      expect(plans).toHaveLength(2);
    });
  });

  describe('simplePathPlans', () => {
    it('Should dedup simple path plans too', () => {
      const model = createTestModel(multiPathMachine);

      const plans = model.getSimplePlans();

      expect(plans).toHaveLength(2);
    });
  });
});