import React, { createContext, useContext, useState } from 'react';
import CustomErrorDialog from '@/components/feedback/CustomErrorDialog';
const ErrorContext = createContext(undefined);
export const ErrorProvider = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [errorData, setErrorData] = useState({
        title: '',
        message: '',
        errorType: 'unknown'
    });
    const showError = (title, message, errorType, onRetry, onDismiss, onConfigureBackend) => {
        setErrorData({ title, message, errorType, onRetry, onDismiss, onConfigureBackend });
        setIsOpen(true);
    };
    const hideError = () => {
        setIsOpen(false);
    };
    const handleRetry = () => {
        if (errorData.onRetry) {
            errorData.onRetry();
        }
        setIsOpen(false);
    };
    const handleDismiss = () => {
        if (errorData.onDismiss) {
            errorData.onDismiss();
        }
        setIsOpen(false);
    };
    const handleConfigureBackend = () => {
        if (errorData.onConfigureBackend) {
            errorData.onConfigureBackend();
        }
        setIsOpen(false);
    };
    return (<ErrorContext.Provider value={{ showError, hideError }}>
      {children}
      <CustomErrorDialog isOpen={isOpen} onClose={hideError} title={errorData.title} message={errorData.message} errorType={errorData.errorType} onRetry={errorData.onRetry ? handleRetry : undefined} onDismiss={errorData.onDismiss ? handleDismiss : undefined} onConfigureBackend={errorData.onConfigureBackend ? handleConfigureBackend : undefined}/>
    </ErrorContext.Provider>);
};
export const useError = () => {
    const context = useContext(ErrorContext);
    if (context === undefined) {
        throw new Error('useError must be used within an ErrorProvider');
    }
    return context;
};
