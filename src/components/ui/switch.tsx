"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-700 data-[state=unchecked]:bg-zinc-300 data-[state=unchecked]:border-zinc-400 focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=checked]:bg-emerald-500 dark:data-[state=checked]:border-transparent dark:data-[state=unchecked]:bg-input/80 dark:data-[state=unchecked]:border-transparent inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-white pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
