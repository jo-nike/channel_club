import { Construction } from 'lucide-react'

interface PlaceholderTabProps {
  title: string
  message: string
  description?: string
}

export function PlaceholderTab({ title, message, description }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Construction className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{message}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-2 max-w-md">
          {description}
        </p>
      )}
    </div>
  )
}
