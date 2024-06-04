export const description = `Test compute shader builtin variables`;

import { makeTestGroup } from '../../../../common/framework/test_group.js';
import { GPUTest } from '../../../gpu_test.js';

export const g = makeTestGroup(GPUTest);

// Test that the values for each input builtin are correct.
g.test('inputs')
  .desc(`Test compute shader builtin inputs values`)
  .params(u =>
    u
      .combine('method', ['param', 'struct', 'mixed'] as const)
      .combine('dispatch', ['direct', 'indirect'] as const)
      .combineWithParams([
        {
          groupSize: { x: 1, y: 1, z: 1 },
          numGroups: { x: 1, y: 1, z: 1 },
        },
        {
          groupSize: { x: 8, y: 4, z: 2 },
          numGroups: { x: 1, y: 1, z: 1 },
        },
        {
          groupSize: { x: 1, y: 1, z: 1 },
          numGroups: { x: 8, y: 4, z: 2 },
        },
        {
          groupSize: { x: 3, y: 7, z: 5 },
          numGroups: { x: 13, y: 9, z: 11 },
        },
      ] as const)
      .beginSubcases()
  )
  .fn(t => {
    const invocationsPerGroup = t.params.groupSize.x * t.params.groupSize.y * t.params.groupSize.z;
    const totalInvocations =
      invocationsPerGroup * t.params.numGroups.x * t.params.numGroups.y * t.params.numGroups.z;

    // Generate the structures, parameters, and builtin expressions used in the shader.
    let params = '';
    let structures = '';
    let local_id = '';
    let local_index = '';
    let global_id = '';
    let group_id = '';
    let num_groups = '';
    switch (t.params.method) {
      case 'param':
        params = `
          @builtin(local_invocation_id) local_id : vec3<u32>,
          @builtin(local_invocation_index) local_index : u32,
          @builtin(global_invocation_id) global_id : vec3<u32>,
          @builtin(workgroup_id) group_id : vec3<u32>,
          @builtin(num_workgroups) num_groups : vec3<u32>,
        `;
        local_id = 'local_id';
        local_index = 'local_index';
        global_id = 'global_id';
        group_id = 'group_id';
        num_groups = 'num_groups';
        break;
      case 'struct':
        structures = `struct Inputs {
            @builtin(local_invocation_id) local_id : vec3<u32>,
            @builtin(local_invocation_index) local_index : u32,
            @builtin(global_invocation_id) global_id : vec3<u32>,
            @builtin(workgroup_id) group_id : vec3<u32>,
            @builtin(num_workgroups) num_groups : vec3<u32>,
          };`;
        params = `inputs : Inputs`;
        local_id = 'inputs.local_id';
        local_index = 'inputs.local_index';
        global_id = 'inputs.global_id';
        group_id = 'inputs.group_id';
        num_groups = 'inputs.num_groups';
        break;
      case 'mixed':
        structures = `struct InputsA {
          @builtin(local_invocation_index) local_index : u32,
          @builtin(global_invocation_id) global_id : vec3<u32>,
        };
        struct InputsB {
          @builtin(workgroup_id) group_id : vec3<u32>
        };`;
        params = `@builtin(local_invocation_id) local_id : vec3<u32>,
                  inputsA : InputsA,
                  inputsB : InputsB,
                  @builtin(num_workgroups) num_groups : vec3<u32>,`;
        local_id = 'local_id';
        local_index = 'inputsA.local_index';
        global_id = 'inputsA.global_id';
        group_id = 'inputsB.group_id';
        num_groups = 'num_groups';
        break;
    }

    // WGSL shader that stores every builtin value to a buffer, for every invocation in the grid.
    const wgsl = `
      struct Outputs {
        local_id: vec3u,
        local_index: u32,
        global_id: vec3u,
        group_id: vec3u,
        num_groups: vec3u,
      };
      @group(0) @binding(0) var<storage, read_write> outputs : array<Outputs>;

      ${structures}

      const group_width = ${t.params.groupSize.x}u;
      const group_height = ${t.params.groupSize.y}u;
      const group_depth = ${t.params.groupSize.z}u;

      @compute @workgroup_size(group_width, group_height, group_depth)
      fn main(
        ${params}
        ) {
        let group_index = ((${group_id}.z * ${num_groups}.y) + ${group_id}.y) * ${num_groups}.x + ${group_id}.x;
        let global_index = group_index * ${invocationsPerGroup}u + ${local_index};
        var o: Outputs;
        o.local_id = ${local_id};
        o.local_index = ${local_index};
        o.global_id = ${global_id};
        o.group_id = ${group_id};
        o.num_groups = ${num_groups};
        outputs[global_index] = o;
      }
    `;

    const pipeline = t.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: t.device.createShaderModule({
          code: wgsl,
        }),
        entryPoint: 'main',
      },
    });

    // Offsets are in u32 size units
    const kLocalIdOffset = 0;
    const kLocalIndexOffset = 3;
    const kGlobalIdOffset = 4;
    const kGroupIdOffset = 8;
    const kNumGroupsOffset = 12;
    const kOutputElementSize = 16;

    // Create the output buffers.
    const outputBuffer = t.device.createBuffer({
      size: totalInvocations * kOutputElementSize * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    t.trackForCleanup(outputBuffer);

    const bindGroup = t.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: outputBuffer } }],
    });

    // Run the shader.
    const encoder = t.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    switch (t.params.dispatch) {
      case 'direct':
        pass.dispatchWorkgroups(t.params.numGroups.x, t.params.numGroups.y, t.params.numGroups.z);
        break;
      case 'indirect': {
        const dispatchBuffer = t.device.createBuffer({
          size: 3 * Uint32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.INDIRECT,
          mappedAtCreation: true,
        });
        t.trackForCleanup(dispatchBuffer);
        const dispatchData = new Uint32Array(dispatchBuffer.getMappedRange());
        dispatchData[0] = t.params.numGroups.x;
        dispatchData[1] = t.params.numGroups.y;
        dispatchData[2] = t.params.numGroups.z;
        dispatchBuffer.unmap();
        pass.dispatchWorkgroupsIndirect(dispatchBuffer, 0);
        break;
      }
    }
    pass.end();
    t.queue.submit([encoder.finish()]);

    type vec3 = { x: number; y: number; z: number };

    // Helper to check that the vec3<u32> value at each index of the provided `output` buffer
    // matches the expected value for that invocation, as generated by the `getBuiltinValue`
    // function. The `name` parameter is the builtin name, used for error messages.
    const checkEachIndex = (output: Uint32Array) => {
      // Loop over workgroups.
      for (let gz = 0; gz < t.params.numGroups.z; gz++) {
        for (let gy = 0; gy < t.params.numGroups.y; gy++) {
          for (let gx = 0; gx < t.params.numGroups.x; gx++) {
            // Loop over invocations within a group.
            for (let lz = 0; lz < t.params.groupSize.z; lz++) {
              for (let ly = 0; ly < t.params.groupSize.y; ly++) {
                for (let lx = 0; lx < t.params.groupSize.x; lx++) {
                  const groupIndex = (gz * t.params.numGroups.y + gy) * t.params.numGroups.x + gx;
                  const localIndex = (lz * t.params.groupSize.y + ly) * t.params.groupSize.x + lx;
                  const globalIndex = groupIndex * invocationsPerGroup + localIndex;
                  const globalOffset = globalIndex * kOutputElementSize;

                  const expectEqual = (name: string, expected: number, actual: number) => {
                    if (actual !== expected) {
                      return new Error(
                        `${name} failed at group(${gx},${gy},${gz}) local(${lx},${ly},${lz}))\n` +
                          `    expected: ${expected}\n` +
                          `    got:      ${actual}`
                      );
                    }
                    return undefined;
                  };

                  const checkVec3Value = (name: string, fieldOffset: number, expected: vec3) => {
                    const offset = globalOffset + fieldOffset;
                    return (
                      expectEqual(`${name}.x`, expected.x, output[offset + 0]) ||
                      expectEqual(`${name}.y`, expected.y, output[offset + 1]) ||
                      expectEqual(`${name}.z`, expected.z, output[offset + 2])
                    );
                  };

                  const error =
                    checkVec3Value('local_id', kLocalIdOffset, { x: lx, y: ly, z: lz }) ||
                    checkVec3Value('global_id', kGlobalIdOffset, {
                      x: gx * t.params.groupSize.x + lx,
                      y: gy * t.params.groupSize.y + ly,
                      z: gz * t.params.groupSize.z + lz,
                    }) ||
                    checkVec3Value('group_id', kGroupIdOffset, { x: gx, y: gy, z: gz }) ||
                    checkVec3Value('num_groups', kNumGroupsOffset, t.params.numGroups) ||
                    expectEqual(
                      'local_index',
                      localIndex,
                      output[globalOffset + kLocalIndexOffset]
                    );
                  if (error) {
                    return error;
                  }
                }
              }
            }
          }
        }
      }
      return undefined;
    };

    t.expectGPUBufferValuesPassCheck(outputBuffer, outputData => checkEachIndex(outputData), {
      type: Uint32Array,
      typedLength: outputBuffer.size / 4,
    });
  });
