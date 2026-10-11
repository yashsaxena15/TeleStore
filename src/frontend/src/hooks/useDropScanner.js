import { useCallback } from 'react';
import { processDropItems } from '@/lib/folderTraversal';
export const useDropScanner = () => {
    const scanDropItems = useCallback(async (items) => {
        return await processDropItems(items);
    }, []);
    return {
        scanDropItems
    };
};
