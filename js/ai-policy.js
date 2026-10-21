/**
 * 掼蛋自对弈策略运行时。
 * 权重由 tools/train_policy.py 生成；纯 JavaScript 前向计算兼容 file:// 直接打开。
 */

function predictGuandanPolicy(features, policy = GUANDAN_POLICY) {
    if (!policy) return NaN;
    if (!['gd-candidate-v1', 'gd-candidate-v2', 'gd-candidate-v3', 'gd-pass-v1'].includes(policy.featureVersion)
        || features.length !== policy.inputSize) return NaN;

    if (policy.modelType === 'extra-trees' && Array.isArray(policy.trees)) {
        let total = 0;
        for (const tree of policy.trees) {
            let node = 0;
            while (tree.f[node] >= 0) {
                node = features[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node];
            }
            total += tree.v[node];
        }
        return total / policy.trees.length;
    }

    let values = features;
    for (let layerIndex = 0; layerIndex < policy.layers.length; layerIndex++) {
        const layer = policy.layers[layerIndex];
        if (!layer || !Array.isArray(layer.weights) || !Array.isArray(layer.biases)) return NaN;
        const next = new Array(layer.biases.length);
        for (let output = 0; output < layer.biases.length; output++) {
            let total = layer.biases[output];
            for (let input = 0; input < values.length; input++) {
                total += values[input] * layer.weights[input][output];
            }
            next[output] = layerIndex === policy.layers.length - 1
                ? total
                : Math.max(0, total);
        }
        values = next;
    }
    return values[0];
}
