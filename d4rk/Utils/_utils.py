def progress_bar(pct):
    try:
        pct = float(str(pct).strip("%"))
    except ValueError:
        pct = 0
    p = min(max(pct, 0), 100)
    cFull = int(p // 8)
    cPart = int(p % 8 - 1)
    p_str = "■" * cFull
    
    if cFull < 12:
        if cPart >= 0:
            p_str += ["▤", "▥", "▦", "▧", "▨", "▩", "■"][cPart]
            
    if len(p_str) > 12:
        p_str = p_str[:12]
        
    p_str += "□" * (12 - len(p_str))
    return f"{p_str}"
