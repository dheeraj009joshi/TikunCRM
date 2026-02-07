"use client";

import { Button } from "@/components/ui/button";

interface DialPadProps {
  onDigit: (digit: string) => void;
  disabled?: boolean;
}

const DIAL_PAD_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

const DIAL_PAD_LETTERS: Record<string, string> = {
  "2": "ABC",
  "3": "DEF",
  "4": "GHI",
  "5": "JKL",
  "6": "MNO",
  "7": "PQRS",
  "8": "TUV",
  "9": "WXYZ",
};

export function DialPad({ onDigit, disabled }: DialPadProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {DIAL_PAD_KEYS.flat().map((key) => (
        <Button
          key={key}
          variant="outline"
          className="h-14 text-lg font-semibold flex flex-col items-center justify-center"
          onClick={() => onDigit(key)}
          disabled={disabled}
        >
          <span>{key}</span>
          {DIAL_PAD_LETTERS[key] && (
            <span className="text-[10px] text-muted-foreground tracking-wider">
              {DIAL_PAD_LETTERS[key]}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
