// Generated from the Supabase project "Kalima" (hgqwynzyveizfssjtjxn) via the Supabase MCP.
// Regenerate after every migration; do not edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chunks: {
        Row: {
          content: string
          course_id: string
          created_at: string
          figure_descriptions: Json
          id: string
          idx: number
          page_ref: string | null
          title: string
        }
        Insert: {
          content: string
          course_id: string
          created_at?: string
          figure_descriptions?: Json
          id?: string
          idx: number
          page_ref?: string | null
          title: string
        }
        Update: {
          content?: string
          course_id?: string
          created_at?: string
          figure_descriptions?: Json
          id?: string
          idx?: number
          page_ref?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_pages: {
        Row: {
          course_id: string
          created_at: string
          figure_descriptions: Json
          image_path: string | null
          page_no: number
          text: string
        }
        Insert: {
          course_id: string
          created_at?: string
          figure_descriptions?: Json
          image_path?: string | null
          page_no: number
          text?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          figure_descriptions?: Json
          image_path?: string | null
          page_no?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_pages_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          content_hash: string | null
          created_at: string
          error: string | null
          id: string
          lang: string
          page_count: number | null
          pages_done: number
          platform: string | null
          source_type: string
          source_url: string | null
          status: string
          storage_path: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          error?: string | null
          id?: string
          lang?: string
          page_count?: number | null
          pages_done?: number
          platform?: string | null
          source_type: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          error?: string | null
          id?: string
          lang?: string
          page_count?: number | null
          pages_done?: number
          platform?: string | null
          source_type?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      image_descriptions: {
        Row: {
          created_at: string
          detailed: string
          image_hash: string
          lang: string
          model: string
          short: string
        }
        Insert: {
          created_at?: string
          detailed: string
          image_hash: string
          lang: string
          model: string
          short: string
        }
        Update: {
          created_at?: string
          detailed?: string
          image_hash?: string
          lang?: string
          model?: string
          short?: string
        }
        Relationships: []
      }
      lesson_sessions: {
        Row: {
          course_id: string
          created_at: string
          current_chunk_idx: number
          id: string
          mode: string
          sentence_offset: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          current_chunk_idx?: number
          id?: string
          mode?: string
          sentence_offset?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          current_chunk_idx?: number
          id?: string
          mode?: string
          sentence_offset?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_sessions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          chunk_idx: number | null
          content: string
          created_at: string
          id: string
          kind: string
          lang: string
          role: string
          session_id: string
        }
        Insert: {
          chunk_idx?: number | null
          content: string
          created_at?: string
          id?: string
          kind: string
          lang?: string
          role: string
          session_id: string
        }
        Update: {
          chunk_idx?: number | null
          content?: string
          created_at?: string
          id?: string
          kind?: string
          lang?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "lesson_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          detail_level: string
          id: string
          locale: string
          rate: number
          updated_at: string
          voice: string | null
        }
        Insert: {
          created_at?: string
          detail_level?: string
          id: string
          locale?: string
          rate?: number
          updated_at?: string
          voice?: string | null
        }
        Update: {
          created_at?: string
          detail_level?: string
          id?: string
          locale?: string
          rate?: number
          updated_at?: string
          voice?: string | null
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          answers: Json
          created_at: string
          id: string
          quiz_id: string
          results: Json
          score: number
          weak_chunk_ids: string[]
        }
        Insert: {
          answers: Json
          created_at?: string
          id?: string
          quiz_id: string
          results: Json
          score: number
          weak_chunk_ids?: string[]
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          quiz_id?: string
          results?: Json
          score?: number
          weak_chunk_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          created_at: string
          id: string
          questions: Json
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          questions: Json
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          questions?: Json
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "lesson_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          anon_id: string
          created_at: string
          duration_ms: number | null
          event: string
          id: number
          meta: Json
          platform: string | null
        }
        Insert: {
          anon_id: string
          created_at?: string
          duration_ms?: number | null
          event: string
          id?: never
          meta?: Json
          platform?: string | null
        }
        Update: {
          anon_id?: string
          created_at?: string
          duration_ms?: number | null
          event?: string
          id?: never
          meta?: Json
          platform?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
