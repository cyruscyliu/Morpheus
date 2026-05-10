export {};

const TOOL_DESCRIPTOR_SCHEMA = {
  type: "object",
  required: ["name", "cli-contract"],
  additionalProperties: true,
  properties: {
    name: { type: "string", minLength: 1 },
    runtime: { type: ["string", "null"] },
    entry: { type: ["string", "null"] },
    "cli-contract": { type: "string", minLength: 1 },
    runGuard: {
      type: "object",
      additionalProperties: true,
      required: ["scope", "keyTemplate"],
      properties: {
        scope: { type: "string", minLength: 1 },
        keyTemplate: { type: "string", minLength: 1 },
      },
    },
    config: {
      type: "object",
      additionalProperties: true,
      properties: {
        fields: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: true,
            properties: {
              aliases: {
                type: "array",
                items: { type: "string", minLength: 1 },
              },
              path: { type: "boolean" },
              boolean: { type: "boolean" },
              repeatable: { type: "boolean" },
            },
          },
        },
      },
    },
    inputs: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
      },
    },
    managed: {
      type: "object",
      additionalProperties: true,
      required: ["schemaVersion", "modes"],
      properties: {
        schemaVersion: { type: "integer" },
        modes: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        local: {
          type: "object",
          additionalProperties: true,
          properties: {
            sourceTemplate: { type: "string" },
            downloadsDir: { type: "string" },
            outputDirTemplate: { type: "string" },
            buildDirTemplate: { type: "string" },
            installDirTemplate: { type: "string" },
            execDirTemplate: { type: "string" },
            artifactPath: { type: "string" },
            artifacts: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: true,
                properties: {
                  path: { type: "string" },
                  pathTemplate: { type: "string" },
                },
              },
            },
            commands: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: true,
                properties: {
                  requiredFlags: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                  },
                  scalarFlags: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                  },
                  repeatableFlags: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                  },
                  pathFlags: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                  script: {
                    type: "object",
                    additionalProperties: true,
                    required: ["path", "shell"],
                    properties: {
                      path: { type: "string", minLength: 1 },
                      shell: { type: "string", minLength: 1 },
                      cwdTemplate: { type: "string" },
                    },
                  },
                  result: {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                      successSummary: { type: "string" },
                      reusedSummary: { type: "string" },
                      attachedSuccessSummary: { type: "string" },
                      errorSummary: { type: "string" },
                      logFileTemplate: { type: "string" },
                      manifestTemplate: { type: "string" },
                      artifact: {
                        type: "object",
                        additionalProperties: true,
                        properties: {
                          path: { type: "string" },
                          locationTemplate: { type: "string" },
                        },
                      },
                      details: {
                        type: "object",
                        additionalProperties: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

module.exports = {
  TOOL_DESCRIPTOR_SCHEMA,
};
