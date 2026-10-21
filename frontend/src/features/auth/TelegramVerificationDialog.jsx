import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { openUrl } from "@/lib/tauri-fs";
import logger from "@/lib/logger";
import { Bot, Link, Check } from "lucide-react";
export const TelegramVerificationDialog = ({ open, onOpenChange, onVerificationComplete, }) => {
    const [isGeneratingLink, setIsGeneratingLink] = useState(false);
    const [verificationData, setVerificationData] = useState(null);
    const handleGenerateLink = async () => {
        setIsGeneratingLink(true);
        try {
            const baseUrl = getApiBaseUrl();
            const apiUrl = baseUrl ? `${baseUrl}` : '';
            // Request a verification code
            const response = await fetchWithTimeout(`${apiUrl}/telegram/generate-verification`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: "None"
                }),
            }, 5000);
            if (response.ok) {
                const data = await response.json();
                setVerificationData({
                    botUsername: data.bot_username,
                    link: data.verification_link,
                    code: data.code
                });
            }
            else {
                throw new Error("Failed to generate verification link");
            }
        }
        catch (error) {
            logger.error("Failed to generate Telegram verification link", error);
            toast.error("Failed to generate verification link. Please try again.");
        }
        finally {
            setIsGeneratingLink(false);
        }
    };
    const handleVerificationConfirm = () => {
        if (verificationData) {
            openUrl(verificationData.link);
            onOpenChange(false);
            if (onVerificationComplete) {
                onVerificationComplete();
            }
        }
    };
    const handleVerificationCancel = () => {
        onOpenChange(false);
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary"/>
            Telegram Verification Required
          </DialogTitle>
          <DialogDescription className="pt-2">
            Please verify your Telegram account to enable file uploads.
          </DialogDescription>
        </DialogHeader>
        
        {!verificationData ? (<div className="space-y-4 py-4">
            <p className="text-muted-foreground">
              Connect your Telegram account to enable file uploads and additional features.
            </p>
            <Button onClick={handleGenerateLink} disabled={isGeneratingLink} className="w-full flex items-center gap-2">
              {isGeneratingLink ? (<>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-solid border-primary-foreground border-r-transparent align-[-0.125em]"></div>
                  Generating Link...
                </>) : (<>
                  <Link className="h-4 w-4"/>
                  Generate Verification Link
                </>)}
            </Button>
          </div>) : (<div className="space-y-4 py-4">
            <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">Verification Code</p>
              <p className="font-mono text-lg font-bold text-primary">{verificationData.code}</p>
            </div>
            <p className="text-muted-foreground">
              Click &ldquo;Verify&rdquo; to open Telegram and complete the verification process with bot @{verificationData.botUsername}.
            </p>
          </div>)}
        
        <DialogFooter>
          {verificationData && (<Button onClick={handleVerificationConfirm} className="flex items-center gap-2 w-full">
              <Check className="h-4 w-4"/>
              Verify on Telegram
            </Button>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};
