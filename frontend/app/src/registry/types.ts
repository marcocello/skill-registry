export type Role = 'User' | 'Admin' | 'Open'
export type SkillPurpose =
  | 'Design'
  | 'Legal'
  | 'Support'
  | 'Operations'
  | 'Engineering'
  | 'Writing'
export type SkillStatus = 'Current' | 'Stale'
export type ProposalState = 'pending' | 'approved' | 'rejected'

export type BinaryFileContent = {
  encoding: 'base64'
  data: string
}

export type FileContent = string | BinaryFileContent
export type BundleFiles = Record<string, FileContent>

export type SkillFile = {
  path: string
  content: string
  binary?: boolean
}

export type SkillVersion = {
  version: number
  date: string
  author: string
  note: string
}

export type Skill = {
  source?: 'demo' | 'registry'
  slug: string
  name: string
  displayName?: string
  description: string
  purpose?: SkillPurpose
  owner?: string
  updated: string
  status?: SkillStatus
  version: number
  files: SkillFile[]
  history: SkillVersion[]
  gitExportStatus?: 'Exported' | 'Pending export'
  detailLoaded?: boolean
}

export type Proposal = {
  id: string
  action: 'create' | 'update'
  slug: string
  base_version: number | null
  name: string
  description: string
  files: BundleFiles
  author: string
  status: ProposalState
  revision: number
  edited_by: string | null
  reviewed_by: string | null
  decision_reason: string | null
  created_at: string
  updated_at: string
  decided_at: string | null
}

export type RoutePath =
  | '/'
  | '/connect'
  | '/review'
  | '/settings'
  | `/skills/${string}`
