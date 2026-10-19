import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import logger from "@/lib/logger";

// Keeps one failing part of the UI from unmounting the whole app.
// `fallback="silent"` renders nothing (for floating widgets); otherwise a small retry card.
export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        logger.error(`UI error in ${this.props.name || "component"}:`, error, info?.componentStack);
    }
    reset = () => this.setState({ error: null });
    render() {
        if (!this.state.error)
            return this.props.children;
        if (this.props.fallback === "silent")
            return null;
        return (<div role="alert" className="m-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0"/>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{this.props.name ? `${this.props.name} stopped working` : "This part of the page stopped working"}</p>
          <p className="text-muted-foreground mt-0.5 break-words">{String(this.state.error?.message || this.state.error)}</p>
        </div>
        <button onClick={this.reset} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 h-8 text-xs hover:bg-muted shrink-0">
          <RotateCcw className="w-3.5 h-3.5"/>Try again
        </button>
      </div>);
    }
}
