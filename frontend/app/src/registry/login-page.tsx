import { faFolderTree } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function LoginPage() {
  const returnTo = `${window.location.pathname}${window.location.search}`
  const login = `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`
  return (
    <main className='flex min-h-svh items-center justify-center bg-background px-5 py-10'>
      <section
        className='flex w-full max-w-sm flex-col gap-6'
        aria-labelledby='login-title'
        aria-describedby='login-description'
      >
        <header className='flex items-center justify-center gap-3'>
          <FontAwesomeIcon
            icon={faFolderTree}
            aria-hidden='true'
            className='size-5 shrink-0'
          />
          <h1 className='font-manrope text-xl font-semibold tracking-tight'>
            Skill Registry
          </h1>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id='login-title' className='text-xl'>
                Login
              </h2>
            </CardTitle>
            <CardDescription id='login-description'>
              Sign in with Google to access Skill Registry.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Button asChild variant='outline' className='w-full'>
              <a href={login}>
                <GoogleLogo />
                Continue with Google
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function GoogleLogo() {
  return (
    <svg aria-hidden='true' viewBox='0 0 18 18' className='size-4 shrink-0'>
      <path
        fill='#4285F4'
        d='M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.613Z'
      />
      <path
        fill='#34A853'
        d='M9 18c2.43 0 4.468-.806 5.956-2.182l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z'
      />
      <path
        fill='#FBBC05'
        d='M3.963 10.705A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.705V4.963H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.037l3.007-2.332Z'
      />
      <path
        fill='#EA4335'
        d='M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.963l3.007 2.332C4.672 5.166 6.656 3.58 9 3.58Z'
      />
    </svg>
  )
}
