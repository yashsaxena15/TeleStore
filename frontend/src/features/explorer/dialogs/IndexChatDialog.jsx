import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApiBaseUrl, fetchWithTimeout } from "@/lib/api";
import { openUrl } from "@/lib/tauri-fs";
import logger from "@/lib/logger";
import { Bot, Check, X } from "lucide-react";
export const IndexChatDialog = ({ open, onOpenChange }) => {
    const [botUsername, setBotUsername] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    // Fetch bot username when dialog opens
    useEffect(() => {
        if (open) {
            fetchBotUsername();
        }
    }, [open]);
    const fetchBotUsername = async () => {
        setIsLoading(true);
        try {
            const baseUrl = getApiBaseUrl();
            const apiUrl = baseUrl ? `${baseUrl}` : '';
            // Request a verification code to get the bot username
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
                setBotUsername(data.bot_username);
            }
            else {
                throw new Error("Failed to fetch bot information");
            }
        }
        catch (error) {
            logger.error("Failed to fetch bot username", error);
            setBotUsername(null);
        }
        finally {
            setIsLoading(false);
        }
    };
    // A group or a channel: Telegram lists each in its own picker. In a channel the bot joins as an
    // admin that can post, edit and delete (it keeps your files there).
    const open_ = (kind) => {
        if (botUsername) {
            openUrl(kind === "channel"
                ? `https://t.me/${botUsername}?startchannel=true&admin=post_messages+edit_messages+delete_messages`
                : `https://t.me/${botUsername}?startgroup=true`);
        }
        onOpenChange(false);
    };
    const handleCancel = () => {
        onOpenChange(false);
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary"/>
            Add me to your Index chat
          </DialogTitle>
          <DialogDescription className="pt-2">
            Your files are kept in a private Telegram group or channel of yours. Add the bot to it, then tap Ok on
            the message the bot posts there.
          </DialogDescription>
        </DialogHeader>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleCancel} className="flex items-center gap-2">
            <X className="h-4 w-4"/>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => open_("channel")} disabled={isLoading || !botUsername} className="flex items-center gap-2">
            Add to a channel
          </Button>
          <Button onClick={() => open_("group")} disabled={isLoading || !botUsername} className="flex items-center gap-2">
            {isLoading ? (<>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-solid border-primary-foreground border-r-transparent align-[-0.125em]"></div>
                Loading...
              </>) : (<>
                <Check className="h-4 w-4"/>
                Add to a group
              </>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
};
