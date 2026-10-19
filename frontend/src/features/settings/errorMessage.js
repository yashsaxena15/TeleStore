// Turns a failed fetch's text (often a FastAPI {"detail": …} body) into a readable message
export const errorMessage = (error, fallback = "Something went wrong") => {
    const text = error instanceof Error ? error.message : String(error || "");
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.detail === "string") return parsed.detail;
    }
    catch {
        // not JSON
    }
    return text || fallback;
};
