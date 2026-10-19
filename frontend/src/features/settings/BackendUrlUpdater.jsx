import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateApiBaseUrl, getApiBaseUrl } from "@/lib/api";
import logger from "@/lib/logger";
import { testBackendUrl, isValidBackendUrl } from "./connection";

export const BackendUrlUpdater = ({ onErrorUpdate, onSuccess }) => {
    const [backendUrl, setBackendUrl] = useState(getApiBaseUrl());
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    const handleUrlChange = (e) => {
        setBackendUrl(e.target.value);
        setTestResult(null);
    };

    const handleSave = () => {
        try {
            logger.info("Saving backend URL", { backendUrl });
            updateApiBaseUrl(backendUrl);
            if (onSuccess) {
                onSuccess();
            }
        }
        catch (error) {
            logger.error("Failed to save backend URL", error);
            if (onErrorUpdate) {
                onErrorUpdate("Failed to save backend URL");
            }
        }
    };

    const handleTestConnection = async () => {
        if (!backendUrl) {
            setTestResult({ success: false, message: "Please enter a backend URL" });
            return;
        }
        if (!isValidBackendUrl(backendUrl)) {
            setTestResult({ success: false, message: "Enter a valid http:// or https:// address" });
            return;
        }
        setIsTesting(true);
        setTestResult(null);
        try {
            logger.info("Testing connection to backend", { backendUrl });
            const result = await testBackendUrl(backendUrl);
            setTestResult({ success: result.ok, message: result.message });
        }
        catch (error) {
            logger.error("Backend connection test failed", error);
            setTestResult({ success: false, message: "Connection failed" });
        }
        finally {
            setIsTesting(false);
        }
    };

    const handleReset = () => {
        logger.info("Resetting backend URL to default");
        setBackendUrl("");
        updateApiBaseUrl("");
        setTestResult(null);
        if (onSuccess) {
            onSuccess();
        }
    };

    return (<Card className="w-full max-w-md border-border bg-card">
      <CardHeader>
        <CardTitle>Backend Configuration</CardTitle>
        <CardDescription>
          Configure the backend server URL for authentication
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="backendUrl">Backend URL</Label>
          <Input id="backendUrl" placeholder="http://localhost:8000" value={backendUrl} onChange={handleUrlChange}/>
        </div>
        
        <div className="flex gap-2">
          <Button onClick={handleTestConnection} disabled={isTesting} variant="outline" size="sm">
            {isTesting ? "Testing..." : "Test Connection"}
          </Button>
          <Button onClick={handleSave} disabled={!backendUrl} size="sm">
            Save
          </Button>
          <Button onClick={handleReset} variant="ghost" size="sm">
            Reset
          </Button>
        </div>
        
        {testResult && (<div className={`p-2.5 rounded-md text-xs font-medium border ${testResult.success
                ? "bg-success/10 text-success border-success/25"
                : "bg-destructive/10 text-destructive border-destructive/25"}`}>
            {testResult.message}
          </div>)}
        
        <div className="text-xs text-muted-foreground mt-2">
          <p>Enter the full URL to your backend server (e.g., http://localhost:8000)</p>
        </div>
      </CardContent>
    </Card>);
};
