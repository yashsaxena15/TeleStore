// What a machine in Transfers › Workers is doing, in words
const running = (n) => (n > 0 ? `${n} transfer${n === 1 ? "" : "s"} running` : "Idle");

export const machineState = (m) => {
    if (m.paused) {
        return {
            label: "Paused",
            tone: "warning",
            detail: m.running > 0 ? `Finishing ${m.running} transfer${m.running === 1 ? "" : "s"}, then waits` : "Takes no new transfers until resumed",
        };
    }
    if (!m.online) return { label: "Offline", tone: "muted", detail: "Not reporting in. Its transfers go to the other machines." };
    return { label: "Online", tone: "success", detail: running(m.running || 0) };
};
